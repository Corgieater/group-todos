import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  AssignTaskPayload,
  GroupMemberInfo,
  SubTaskAddPayload,
  SubTaskWithAssignees,
  TasksAddPayload,
  TaskUpdatePayload,
  TaskWithAllDetails,
  UpdateStatusOpts,
  InternalAssignOptions,
} from './types/tasks';
import {
  AssignmentStatus,
  GroupRole,
  Prisma,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import type { SubTask } from 'src/generated/prisma/client';
import { TaskStatus } from './types/enum';
import { GroupsErrors, TasksErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/mail/mail.service';
import { SecurityService } from 'src/security/security.service';
import { TasksGateWay } from './tasks.gateway';
import { Order, PageOptionsDto } from 'src/common/dto/page-options.dto';
import { PageDto } from 'src/common/dto/page.dto';
import { PageMetaDto } from 'src/common/dto/page-meta.dto';

type DueFilter = 'TODAY' | 'NONE' | 'EXPIRED' | 'RANGE';

type ListTasksScope =
  | { kind: 'owner'; ownerId: number }
  | { kind: 'group'; groupId: number; viewerId: number };

type ListTasksFilters = {
  status?: TaskStatus[]; // 預設 ['UNFINISHED']
  due?: DueFilter[]; // 例：['TODAY','NONE'] / ['EXPIRED']
  range?: { startUtc: Date; endUtc: Date }; // 當 due 包含 'RANGE' 時使用
};

type OrderKey = 'dueAtAscNullsLast' | 'createdAsc' | 'expiredPriority';

type TaskModelFields = Pick<
  Prisma.TaskUpdateInput,
  | 'title'
  | 'description'
  | 'location'
  | 'priority'
  | 'allDay'
  | 'allDayLocalDate'
  | 'dueAtUtc'
  | 'sourceTimeZone'
>;
type SubTaskModelFields = Pick<
  Prisma.SubTaskUpdateInput,
  | 'title'
  | 'description'
  | 'location'
  | 'priority'
  | 'allDay'
  | 'allDayLocalDate'
  | 'dueAtUtc'
  | 'sourceTimeZone'
>;

@Injectable()
export class TasksService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly securityService: SecurityService,
    private readonly tasksGateway: TasksGateWay,
  ) {}

  async createTask(
    payload: TasksAddPayload,
    groupId: number | null = null,
  ): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(payload.userId);
    let dueAtUtc: Date | null = null;
    let allDayLocalDate: Date | null = null;

    if (payload.allDay) {
      allDayLocalDate = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
    } else if (payload.dueDate && payload.dueTime) {
      const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
      dueAtUtc = fromZonedTime(localISO, user.timeZone);
    }
    const data = {
      title: payload.title,
      description: payload.description,
      dueAtUtc: dueAtUtc ? new Date(dueAtUtc) : null,
      allDay: payload.allDay,
      location: payload.location,
      ownerId: user.id,
    };

    if (payload.allDay) {
      data['allDayLocalDate'] = allDayLocalDate;
    } else {
      data['allDayLocalDate'] = null;
    }

    if (dueAtUtc) {
      data['dueAtUtc'] = dueAtUtc;
    }

    if (payload.status) {
      data['status'] = payload.status;
    }
    if (payload.priority) {
      data['priority'] = payload.priority;
    }
    if (groupId) {
      data['groupId'] = groupId;
    }
    await this.prismaService.task.create({ data });
  }

  async getTasks(
    userId: number,
    timeZone: string,
    options: {
      status?: string;
      scope?: string;
      page?: number;
      limit?: number;
      order?: 'ASC' | 'DESC';
    },
  ): Promise<PageDto<any>> {
    const { status, scope, page = 1, limit = 10, order = 'DESC' } = options;
    const skip = (page - 1) * limit;

    // 1. 處理時間邊界 (針對 Future 篩選)
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { startUtc } = dayBoundsUtc(timeZone, tomorrow);

    // 2. 構建動態 SQL 條件 (WHERE 子句)
    // 使用 Prisma.sql 來組合片段，確保查詢安全
    const conditions: Prisma.Sql[] = [Prisma.sql`t."ownerId" = ${userId}`];

    if (status) {
      conditions.push(Prisma.sql`t."status" = ${status}`);
    }

    if (scope === 'FUTURE') {
      conditions.push(
        Prisma.sql`(t."dueAtUtc" > ${startUtc} OR t."allDayLocalDate" > ${startUtc})`,
      );
    }

    const whereFragment = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // 3. 執行資料查詢與總數統計
    const [tasks, totalResult] = await Promise.all([
      this.prismaService.$queryRaw<any[]>`
      SELECT t.*, 
        (SELECT COUNT(*)::int FROM "SubTask" st WHERE st."taskId" = t.id AND st."status" != 'CLOSED') as "subTaskCount",
        (SELECT COUNT(*)::int FROM "TaskAssignee" ta WHERE ta."taskId" = t.id AND ta."status" IN ('PENDING', 'ACCEPTED')) as "assigneeCount"
      FROM "Task" t
      ${whereFragment}
      ORDER BY t."createdAt" ${Prisma.raw(order)}
      LIMIT ${limit} OFFSET ${skip}
    `,
      this.prismaService.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count FROM "Task" t
      ${whereFragment}
    `,
    ]);

    // 4. 建立分頁 Meta 資料
    const itemCount = Number(totalResult[0]?.count ?? 0);
    const pageOptionsDto = { page, limit, skip }; // 模擬 PageOptionsDto 結構
    const meta = new PageMetaDto(pageOptionsDto as any, itemCount);

    // 5. 回傳 PageDto (此處將 tasks 傳入，型別就不再是 unknown)
    return new PageDto(tasks, meta);
  }

  async getTaskForViewer(
    id: number,
    actorId: number,
  ): Promise<{
    task: TaskWithAllDetails;
    isAdminish: boolean;
    canClose: boolean;
    groupMembers: GroupMemberInfo[];
  }> {
    const base = await this.prismaService.task.findUnique({
      where: { id },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!base) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // 權限檢查：個人任務只有 Owner 可見
    if (!base.groupId && base.ownerId !== actorId) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // --- 核心查詢：同時包含 Task Assignees 和 SubTasks 及其 Assignees ---
    const task = await this.prismaService.task.findUnique({
      where: { id },
      include: {
        assignees: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            assignedBy: { select: { id: true, name: true, email: true } },
          },
        },
        subTasks: {
          include: {
            assignees: {
              include: {
                assignee: { select: { id: true, name: true, email: true } },
              },
              orderBy: { status: 'asc' },
            },
          },
          orderBy: { priority: 'asc' },
        },
        group: { select: { name: true } },
      },
    });

    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    let groupMembers: GroupMemberInfo[] = [];
    if (task.groupId) {
      const members = await this.prismaService.groupMember.findMany({
        where: { groupId: task.groupId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      groupMembers = members.map((m) => ({
        id: m.user.id,
        userName: m.user.name,
      }));
    }

    const hasOpenSubTasks = (task.subTasks || []).some(
      (st) => st.status !== TaskStatus.CLOSED,
    );
    const canClose = !hasOpenSubTasks;

    let isAdminish = false;
    if (!base.groupId) {
      isAdminish = true;
    } else {
      const member = await this.prismaService.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId!, userId: actorId } },
        select: { role: true },
      });
      const ADMINISH = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
      isAdminish = ADMINISH.has(member!.role);
    }

    return {
      task: task as TaskWithAllDetails,
      isAdminish,
      canClose,
      groupMembers,
    };
  }

  async listOpenTasksDueTodayNoneOrExpired(ownerId: number): Promise<{
    items: TaskModel[];
    bounds: {
      timeZone: string;
      startUtc: Date;
      endUtc: Date;
      startOfTodayUtc: Date;
      todayDateOnlyUtc: Date;
    };
  }> {
    return this.listTaskCore(
      { kind: 'owner', ownerId },
      { status: ['OPEN'], due: ['TODAY', 'NONE', 'EXPIRED'] },
      'createdAsc',
    );
  }

  async updateTask(
    id: number,
    userId: number,
    payload: TaskUpdatePayload,
  ): Promise<TaskModel> {
    const user = await this.usersService.findByIdOrThrow(userId);

    // 🚨 使用通用函數簡化
    const commonData = this.getCommonUpdateData<Prisma.TaskUpdateInput>(
      payload,
      user.timeZone,
    );

    // 這裡可以使用 Object.assign，但直接使用 commonData 即可，因為它是 TaskUpdateInput 類型
    const data: Prisma.TaskUpdateInput = commonData;

    try {
      const task = await this.prismaService.task.update({
        where: { id },
        data,
      });
      this.notifyTaskChange(task.id, userId, user.name, 'UPDATED');
      return task;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw TasksErrors.TaskNotFoundError.byId(userId, id);
      }

      throw e;
    }
  }

  // 建議將這張表改名為更通用的名稱，或確保它包含系統觸發的轉換
  ALLOWED: Record<AssignmentStatus, AssignmentStatus[]> = {
    [AssignmentStatus.PENDING]: [
      AssignmentStatus.ACCEPTED,
      AssignmentStatus.DECLINED,
      AssignmentStatus.SKIPPED, // 🚨 系統行為：任務關閉時，Pending 轉為跳過
    ],
    [AssignmentStatus.ACCEPTED]: [
      AssignmentStatus.COMPLETED,
      AssignmentStatus.DECLINED,
      AssignmentStatus.DROPPED, // 🚨 系統行為：任務關閉時，已領取者轉為終止
    ],
    [AssignmentStatus.DECLINED]: [
      AssignmentStatus.ACCEPTED,
      // 如果需要，也可以允許 Declined 轉為 Skipped
      AssignmentStatus.SKIPPED,
    ],
    [AssignmentStatus.COMPLETED]: [
      // 如果任務重開，可允許回退到 ACCEPTED (你之前的邏輯)
      AssignmentStatus.ACCEPTED,
    ],
    // 終端狀態通常不允許再往外跳
    [AssignmentStatus.SKIPPED]: [],
    [AssignmentStatus.DROPPED]: [],
  };

  // 指派task, slef-assign, claim
  async updateAssigneeStatus(
    id: number,
    actorId: number,
    dto: { status: AssignmentStatus; reason?: string },
    updatedBy: string | null = null,
  ) {
    const { status: next, reason } = dto;

    return this.prismaService.$transaction(async (tx) => {
      // 1. 一次性載入任務資訊與當前的指派狀態 (優化查詢)
      const task = await tx.task.findUnique({
        where: { id },
        select: {
          id: true,
          groupId: true,
          status: true,
          assignees: {
            where: { assigneeId: actorId },
            select: { status: true },
          },
        },
      });

      if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

      // 權限檢查：必須是群組任務
      if (!task.groupId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'ASSIGNEE_STATUS_FOR_PERSONAL_TASK',
        );
      }

      // 檢查操作者是否為群組成員
      const isMember = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId, userId: actorId } },
        select: { userId: true },
      });
      if (!isMember) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'ASSIGNEE_STATUS_FOR_NON_MEMBER',
        );
      }

      const currentAssignee = task.assignees[0];

      // 2. 自我指派 (Claim) 邏輯：紀錄不存在
      if (!currentAssignee) {
        if (next !== AssignmentStatus.ACCEPTED) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            id,
            'ASSIGNEE_STATUS_ILLEGAL_WITHOUT_ASSIGNMENT',
          );
        }

        await tx.taskAssignee.create({
          data: {
            taskId: task.id,
            assigneeId: actorId,
            assignedById: actorId,
            status: AssignmentStatus.ACCEPTED,
            assignedAt: new Date(),
            acceptedAt: new Date(),
          },
        });
        return { ok: true };
      }

      // 3. 狀態轉換合法性檢查 (State Machine Logic)
      const prev = currentAssignee.status;
      const isLegal = this.checkStatusTransition(prev, next, task.status);

      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // 4. 執行更新
      const updateData = this.getAssigneeUpdateData(next, actorId, reason);

      await tx.taskAssignee.update({
        where: { taskId_assigneeId: { taskId: task.id, assigneeId: actorId } },
        data: updateData,
      });

      this.notifyTaskChange(
        task.id,
        actorId,
        updatedBy!,
        'ASSIGNEE_STATUS_UPDATED',
      );

      return { ok: true };
    });
  }

  async closeTask(
    id: number,
    actorId: number,
    opts?: { reason?: string }, // 移除 force，改由後端邏輯判定
  ) {
    // 1. 聚合查詢：一次拿完所有狀態判定所需的資訊
    const task = await this.prismaService.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        _count: {
          select: {
            subTasks: { where: { status: { not: TaskStatus.CLOSED } } },
            assignees: {
              where: {
                status: {
                  in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
                },
              },
            },
          },
        },
      },
    });

    if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    if (task.status === TaskStatus.CLOSED) return task; // 已關閉則直接回傳

    // 2. 判定是否為「非正常完成」 (Incomplete)
    const hasOpenItems = task._count.subTasks > 0 || task._count.assignees > 0;

    // 3. 邏輯關卡：如果未完成且沒有提供理由，則攔截並要求理由
    if (hasOpenItems && !opts?.reason) {
      // 這裡拋出一個特定的錯誤，前端 Catch 到後顯示「強制關閉理由」彈窗
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        'FORCE_CLOSE_REASON_REQUIRED',
      );
    }

    // 4. 執行結案事務
    return this.prismaService.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          closedById: actorId,
          closedReason: opts?.reason ?? null,
          // 關鍵：標記這是否是一個「帶病結案」的任務
          closedWithOpenAssignees: hasOpenItems,
        },
      });

      // A. 處理未完成的指派：轉為中止狀態
      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.DROPPED, updatedAt: new Date() },
      });

      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.PENDING },
        data: { status: AssignmentStatus.SKIPPED, updatedAt: new Date() },
      });

      // B. (選填) 如果有未完成的 SubTasks，也可以在這邊一併處理關閉
      if (hasOpenItems) {
        await tx.subTask.updateMany({
          where: { taskId: id, status: { not: TaskStatus.CLOSED } },
          data: {
            status: TaskStatus.CLOSED,
            closedById: actorId,
            closedAt: new Date(),
          },
        });
      }

      return updatedTask;
    });
  }

  async archiveTask(id: number, actorId: number) {
    return this.prismaService.$transaction(async (tx) => {
      // 1. 先更新 Parent Task 的狀態 (沿用您現有的權限檢查與狀態轉移邏輯)
      await this.updateTaskStatus(id, {
        target: TaskStatus.ARCHIVED,
        actorId,
      });

      // 2. 一併封存所有屬於此 Task 的 SubTasks
      await tx.subTask.updateMany({
        where: {
          taskId: id,
          status: { not: TaskStatus.ARCHIVED }, // 僅更新尚未封存的
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });
  }

  async restoreTask(id: number) {
    return this.prismaService.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      await tx.subTask.updateMany({
        where: { taskId: id, status: TaskStatus.ARCHIVED },
        data: { status: TaskStatus.OPEN },
      });
    });
  }

  async updateTaskStatus(id: number, opts: UpdateStatusOpts): Promise<void> {
    const { target, actorId, force, reason } = opts;
    const isTargetClosed = target === TaskStatus.CLOSED;

    return this.prismaService.$transaction(async (tx) => {
      // -----------------------------------------------------------
      // 🚨 步驟 1: 提前載入基礎資訊 (用於權限檢查和主查詢的條件判斷)
      // -----------------------------------------------------------
      const baseTask = await tx.task.findUnique({
        where: { id },
        select: { id: true, ownerId: true, groupId: true, status: true },
      });

      if (!baseTask) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

      // -----------------------------------------------------------
      // 步驟 2: 核心資料查詢 (根據目標狀態和 baseTask 載入 Assignees/SubTasks)
      // -----------------------------------------------------------
      const task = await tx.task.findUnique({
        where: { id },
        select: {
          id: true,
          ownerId: true,
          groupId: true,
          status: true,

          // 修正：使用 baseTask.groupId 進行 Assignee 載入判斷
          // 僅在目標是關閉且是群組任務時載入 Assignees
          assignees:
            isTargetClosed && baseTask.groupId !== null
              ? { select: { status: true } }
              : false,

          // 載入 SubTasks 狀態 (用於 SubTask Completion Check)
          subTasks: isTargetClosed ? { select: { status: true } } : false,
        },
      });

      if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

      // -----------------------------------------------------------
      // 3) 權限檢查 (保持不變)
      // -----------------------------------------------------------
      let allowed = task.ownerId === actorId;
      if (!allowed && task.groupId !== null) {
        const member = await tx.groupMember.findUnique({
          where: { groupId_userId: { groupId: task.groupId, userId: actorId } },
          select: { role: true },
        });
        if (!member)
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            id,
            'UPDATE_STATUS',
          );

        const ADMINISH = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
        allowed = ADMINISH.has(member.role);
      }
      if (!allowed)
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'UPDATE_STATUS',
        );

      // -----------------------------------------------------------
      // 4) 狀態轉移規則 (保持不變)
      // -----------------------------------------------------------
      const from = task.status;
      const legal =
        (from === 'OPEN' && (target === 'CLOSED' || target === 'ARCHIVED')) ||
        (from === 'CLOSED' && (target === 'ARCHIVED' || target === 'OPEN')) ||
        (from === 'ARCHIVED' && target === 'OPEN');

      if (!legal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          `ILLEGAL_TRANSITION_${from}_TO_${target}`,
        );
      }

      // -----------------------------------------------------------
      // 5) 🚨 完成度規則 (實作 SubTask 優先邏輯)
      // -----------------------------------------------------------
      let closedWithOpenAssignees = false;
      let closedReason: string | null = null;

      if (isTargetClosed) {
        const subTasks = task.subTasks ?? [];
        const hasSubTasks = subTasks.length > 0;

        if (hasSubTasks) {
          // --- 情況 A: SubTask 優先規則 (Task 有 SubTasks) ---
          const hasOpenSubTasks = subTasks.some(
            (st) => st.status !== TaskStatus.CLOSED,
          );

          if (hasOpenSubTasks) {
            throw TasksErrors.TaskForbiddenError.byActorOnTask(
              actorId,
              id,
              'CANNOT_CLOSE_TASK_WITH_OPEN_SUBTASKS',
            );
          }
          // 如果所有 SubTasks 都已關閉，則允許繼續關閉
        } else if (task.groupId !== null) {
          // --- 情況 B: Assignee 規則 (Group Task 且無 SubTasks) ---

          // 由於 Task Assignees 結構被選中，可以安全地存取
          const assignees = task.assignees ?? [];
          const total = assignees.length;
          const completed = assignees.filter(
            (a) => a.status === AssignmentStatus.COMPLETED,
          ).length;

          const noneCompleted = total > 0 ? completed === 0 : true;
          const someCompleted = total > 0 && completed > 0 && completed < total;

          if (noneCompleted) {
            throw TasksErrors.TaskForbiddenError.byActorOnTask(
              actorId,
              id,
              'CANNOT_CLOSE_WHEN_NO_ASSIGNEE_COMPLETED',
            );
          }
          if (someCompleted && !force) {
            throw TasksErrors.TaskForbiddenError.byActorOnTask(
              actorId,
              id,
              'PARTIALLY_COMPLETED_NEEDS_FORCE',
            );
          }

          closedWithOpenAssignees = someCompleted;
          closedReason = force ? (reason ?? 'CLOSE_FORCEFULLY') : null;
        }
        // Personal Task 且無 SubTask 時，可以直接關閉
      }

      // -----------------------------------------------------------
      // 6) 審計欄位與更新資料 (保持不變)
      // -----------------------------------------------------------
      const data: Prisma.TaskUpdateInput = { status: target };

      if (target === TaskStatus.CLOSED) {
        Object.assign(data, {
          closedAt: new Date(),
          closedById: actorId,
          closedReason,
          closedWithOpenAssignees,
        });
      }

      if (target === TaskStatus.OPEN) {
        // restore：清掉關閉資訊
        Object.assign(data, {
          closedAt: null,
          closedById: null,
          closedReason: null,
          closedWithOpenAssignees: false,
        });
      }

      await tx.task.update({ where: { id }, data });
    });
  }

  // NOTE:
  // Currently not implemented
  // we can turn it into deleteSubTask later
  async deleteTask(id: number, userId: number): Promise<void> {
    const task = await this.prismaService.task.findUnique({
      where: { id, ownerId: userId },
    });
    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(userId, id);
    }

    await this.prismaService.task.delete({ where: { id: task.id } });
  }

  async listGroupOpenTasksDueTodayNoneOrExpired(
    groupId: number,
    userId: number,
  ) {
    return await this.listTaskCore(
      { kind: 'group', groupId, viewerId: userId },
      { status: ['OPEN'], due: ['TODAY', 'NONE', 'EXPIRED'] },
      'createdAsc',
    );
  }

  private async listTaskCore(
    scope: ListTasksScope,
    filters: ListTasksFilters,
    orderByKey: OrderKey,
  ) {
    let timeZone!: string;

    if (scope.kind === 'owner') {
      const user = await this.usersService.findByIdOrThrow(scope.ownerId);
      timeZone = user.timeZone ?? 'UTC';
    } else {
      const member = await this.prismaService.groupMember.findFirst({
        where: { groupId: scope.groupId, userId: scope.viewerId },
        include: { user: { select: { timeZone: true } } },
      });
      if (!member)
        throw GroupsErrors.GroupNotFoundError.byId(
          scope.viewerId,
          scope.groupId,
        );
      timeZone = member.user.timeZone ?? 'UTC';
    }

    const status = filters.status ?? ['OPEN'];
    const due = new Set(filters.due ?? []);
    const OR: Prisma.TaskWhereInput[] = [];

    const { startUtc, endUtc } = dayBoundsUtc(timeZone);
    const todayStr = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const todayDateOnlyUtc = new Date(`${todayStr}T00:00:00.000Z`);

    const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const startOfTodayUtc = fromZonedTime(`${today}T00:00:00`, timeZone);
    if (due.has('NONE')) OR.push({ dueAtUtc: null });
    if (due.has('TODAY')) {
      OR.push(
        { dueAtUtc: { gte: startUtc, lte: endUtc } },
        { allDayLocalDate: { equals: todayDateOnlyUtc } },
      );
    }
    if (due.has('EXPIRED')) {
      const dateOnlyCutoff = new Date(`${today}T00:00:00.000Z`);
      OR.push(
        { dueAtUtc: { not: null, lt: startOfTodayUtc } },
        { allDayLocalDate: { not: null, lt: dateOnlyCutoff } },
      );
    }
    if (due.has('RANGE') && filters.range) {
      OR.push({
        dueAtUtc: { gte: filters.range.startUtc, lte: filters.range.endUtc },
      });
    }

    const where: Prisma.TaskWhereInput =
      scope.kind === 'owner'
        ? {
            ownerId: scope.ownerId,
            groupId: null,
            status: { in: status },
            ...(OR.length ? { OR } : {}),
          }
        : {
            groupId: scope.groupId,
            status: { in: status },
            ...(OR.length ? { OR } : {}),
          };

    const orderBy =
      orderByKey === 'dueAtAscNullsLast'
        ? ([
            { dueAtUtc: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
          ] satisfies Prisma.TaskOrderByWithRelationInput[])
        : orderByKey === 'expiredPriority'
          ? ([
              { allDay: 'desc' },
              { allDayLocalDate: 'asc' },
              { dueAtUtc: 'asc' },
            ] satisfies Prisma.TaskOrderByWithRelationInput[])
          : ([
              { createdAt: 'asc' },
            ] satisfies Prisma.TaskOrderByWithRelationInput[]);

    const items = await this.prismaService.task.findMany({
      where,
      orderBy,
      // 🚨 修正：使用 select 載入所有基礎欄位、assignees 和 _count
      select: {
        // --- 必須手動選取所有 Task 基礎欄位 ---
        id: true,
        ownerId: true,
        groupId: true,
        title: true,
        status: true,
        priority: true,
        description: true,
        location: true,
        dueAtUtc: true,
        allDay: true,
        allDayLocalDate: true,
        sourceTimeZone: true,
        createdAt: true,
        updatedAt: true,
        completionPolicy: true,
        closedAt: true,
        closedById: true,
        closedReason: true,
        closedWithOpenAssignees: true,
        // -------------------------------------

        assignees: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
          },
        },

        _count: {
          select: {
            subTasks: {
              where: {
                status: { not: TaskStatus.CLOSED },
              },
            },
          },
        },
      },
    });

    type TaskWithCount = (typeof items)[number] & {
      _count?: { subTasks: number };
    };

    // 映射結果，並新增 hasOpenSubTasks 標誌
    const mapped = (items as TaskWithCount[]).map((t) => {
      const subTasksCount = t._count?.subTasks ?? 0;
      // 檢查是否有任何未關閉的 SubTask
      const hasOpenSubTasks = subTasksCount > 0;

      // *****************************************************************
      // TODO: Task Assignee 檢查 (如果 Task 有 Completion Policy，這裡更複雜)
      // 為了簡化，我們暫時假設只要 SubTask 完成，就可以考慮關閉。
      // *****************************************************************

      // 這裡將 Assignee 數據扁平化 (保持原樣，但需要考慮加入 canClose 標誌)
      const simplifiedAssignees = (t.assignees ?? []).map((a) => ({
        id: a.assignee.id,
        name: a.assignee.name,
        email: a.assignee.email,
        status: a.status,
      }));

      // 🚨 關鍵：返回時添加 canClose 標誌
      return {
        ...t,
        assignees: simplifiedAssignees,
        // 排除 _count 欄位，它只用於 service 內部計算
        // 決定 Task 是否可以被關閉 (假設只需要 SubTask 檢查)
        canClose: !hasOpenSubTasks,
      };
    });

    return {
      // 🚨 變更：items 的型別現在包含 canClose: boolean
      items: mapped,
      bounds: { timeZone, startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc },
    };
  }

  // ----------------- SubTask -----------------

  async createSubTask(payload: SubTaskAddPayload): Promise<void> {
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: payload.parentTaskId },
      select: {
        id: true,
        owner: { select: { id: true, timeZone: true } },
        groupId: true,
      },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(
        payload.actorId,
        payload.parentTaskId,
      );
    }

    // Personal task，只有 owner 可以新增子任務
    if (!parentTask.groupId) {
      if (parentTask.owner.id !== payload.actorId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          payload.actorId,
          payload.parentTaskId,
          'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
        );
      }
    } else {
      // Group task，檢查成員與角色
      const member = await this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: parentTask.groupId,
            userId: payload.actorId,
          },
        },
        select: { userId: true, role: true },
      });
      if (!member) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          payload.actorId,
          payload.parentTaskId,
          'CREATE_SUBTASK_ON_GROUP_TASK_NOT_MEMBER',
        );
      }
    }
    let dueAtUtc: Date | null = null;
    let allDayLocalDate: Date | null = null;

    if (payload.allDay) {
      allDayLocalDate = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
    } else if (payload.dueDate && payload.dueTime) {
      const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
      dueAtUtc = fromZonedTime(localISO, parentTask.owner.timeZone);
    }
    const data = {
      title: payload.title,
      description: payload.description,
      dueAtUtc: dueAtUtc ? new Date(dueAtUtc) : null,
      allDay: payload.allDay,
      location: payload.location,
      taskId: payload.parentTaskId,
    };

    if (payload.allDay) {
      data['allDayLocalDate'] = allDayLocalDate;
    } else {
      data['allDayLocalDate'] = null;
    }

    if (dueAtUtc) {
      data['dueAtUtc'] = dueAtUtc;
    }

    if (payload.status) {
      data['status'] = payload.status;
    }
    if (payload.priority) {
      data['priority'] = payload.priority;
    }

    // 建立子任務
    await this.prismaService.subTask.create({ data });

    this.notifyTaskChange(
      parentTask.id,
      payload.actorId,
      payload.updatedBy,
      'SUBTASK_CREATED',
    );
  }

  async getSubTaskForViewer(
    parentId: number,
    id: number,
    actorId: number,
  ): Promise<{
    subTask: SubTaskWithAssignees;
    isAdminish: boolean;
    groupMembers: GroupMemberInfo[];
  }> {
    // 1. 獲取父任務的基礎資訊
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: parentId },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, parentId);
    }

    // 2. 權限檢查與 Adminish 判定
    let isAdminish = false;

    if (!parentTask.groupId) {
      // 個人任務：只有 Owner 可以查看，且 Owner 即是 Adminish
      if (parentTask.ownerId !== actorId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'NOT_OWNER',
        );
      }
      isAdminish = true;
    } else {
      // 群組任務：檢查成員資格與角色
      const member = await this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: parentTask.groupId,
            userId: actorId,
          },
        },
        select: { role: true },
      });

      if (!member) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'NOT_MEMBER',
        );
      }

      const ADMINISH = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
      isAdminish = ADMINISH.has(member.role);
    }

    // 3. 核心查詢：獲取子任務細節
    const subTask = await this.prismaService.subTask.findUnique({
      where: { id },
      include: {
        task: {
          select: { id: true, groupId: true },
        },
        closedBy: {
          select: { id: true, name: true },
        },
        assignees: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            assignedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { status: 'asc' },
        },
      },
    });

    if (!subTask) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // 4. 獲取群組成員清單 (用於指派下拉選單)
    let groupMembers: GroupMemberInfo[] = [];
    if (parentTask.groupId) {
      const members = await this.prismaService.groupMember.findMany({
        where: { groupId: parentTask.groupId },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      groupMembers = members.map((m) => ({
        id: m.user.id,
        userName: m.user.name,
      }));
    }

    return {
      subTask: subTask as SubTaskWithAssignees,
      isAdminish,
      groupMembers,
    };
  }

  async updateSubTask(
    id: number,
    actorId: number,
    payload: TaskUpdatePayload,
  ): Promise<SubTask> {
    const user = await this.usersService.findByIdOrThrow(actorId);

    const commonData = this.getCommonUpdateData<Prisma.SubTaskUpdateInput>(
      payload,
      user.timeZone,
    );
    const data: Prisma.SubTaskUpdateInput = commonData;

    try {
      // 這裡需要確保 actorId 有權限更新 SubTask (通常是 Parent Task 的 Owner 或 SubTask 的 Assignee)
      // 由於您沒有在 where 條件中包含權限檢查，如果這是個人任務，可能需要額外的檢查。
      // 暫時保持 where: { id } 不變

      const subTask = await this.prismaService.subTask.update({
        where: { id }, // 🚨 注意：這裡需要 Task ID 和 Owner ID 的組合來做權限檢查
        data,
      });
      return subTask;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // SubTask Not Found 錯誤
        throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      }

      throw e;
    }
  }

  async closeSubTask(id: number, actorId: number) {
    const subTask = await this.prismaService.subTask.findUnique({
      where: { id },
    });
    if (!subTask) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    return this.prismaService.subTask.update({
      where: { id },
      data: {
        status: TaskStatus.CLOSED,
        closedAt: new Date(),
        closedById: actorId,
      },
    });
  }

  async updateSubTaskStatus(
    subTaskId: number,
    opts: UpdateStatusOpts,
  ): Promise<void> {
    const { target, actorId } = opts;

    return this.prismaService.$transaction(async (tx) => {
      // 1) 取基本資料 (只需 status 即可進行狀態轉移檢查)
      const subTask = await tx.subTask.findUnique({
        where: { id: subTaskId },
        // 現在我們只需要 SubTask 自身的 ID 和 Status
        select: {
          id: true,
          status: true,
        },
      });

      if (!subTask)
        throw TasksErrors.TaskNotFoundError.byId(actorId, subTaskId);

      // 2) 權限檢查：(移除複雜邏輯，任何人都可以操作)
      // 由於我們假設 actorId 是經過驗證的，所以無需額外的權限檢查。

      // 3) 狀態轉移規則 (與 Task 相同，保持不變)
      const from = subTask.status;
      const legal =
        (from === TaskStatus.OPEN &&
          (target === TaskStatus.CLOSED || target === TaskStatus.ARCHIVED)) ||
        (from === TaskStatus.CLOSED &&
          (target === TaskStatus.ARCHIVED || target === TaskStatus.OPEN)) ||
        (from === TaskStatus.ARCHIVED && target === TaskStatus.OPEN);

      if (!legal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          `ILLEGAL_SUBTASK_TRANSITION_${from}_TO_${target}`,
        );
      }

      // 4) 審計欄位與更新資料 (保持不變)
      const data: Prisma.SubTaskUpdateInput = { status: target };

      if (target === TaskStatus.CLOSED) {
        // 記錄關閉人、關閉時間和原因
        Object.assign(data, {
          closedAt: new Date(),
          closedById: actorId,
        });
      } else if (target === TaskStatus.OPEN) {
        // restore：清掉關閉資訊
        Object.assign(data, {
          closedAt: null,
          closedById: null,
        });
      }

      // 5) 執行更新
      await tx.subTask.update({ where: { id: subTaskId }, data });
    });
  }

  async restoreSubTask(id: number) {
    return this.prismaService.subTask.update({
      where: { id },
      data: {
        status: TaskStatus.OPEN,
        closedAt: null,
        closedById: null,
      },
    });
  }

  // 指派subTask, self-assign, claim相關
  async updateSubTaskAssigneeStatus(
    subTaskId: number,
    actorId: number,
    dto: { status: AssignmentStatus; reason?: string },
    updatedBy: string | null = null,
  ) {
    const { status: next, reason } = dto;

    return this.prismaService.$transaction(async (tx) => {
      // 1. 獲取子任務與父任務關聯資訊
      const subTask = await tx.subTask.findUnique({
        where: { id: subTaskId },
        include: {
          task: { select: { id: true, groupId: true, status: true } },
        },
      });

      if (!subTask)
        throw TasksErrors.TaskNotFoundError.byId(actorId, subTaskId);

      // 安全檢查：只有群組任務才支援指派狀態更新
      if (!subTask.task.groupId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          'ASSIGNEE_STATUS_FOR_PERSONAL_SUBTASK',
        );
      }

      // 檢查操作者是否為該群組成員
      const member = await tx.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: subTask.task.groupId,
            userId: actorId,
          },
        },
        select: { userId: true },
      });

      if (!member) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          'ASSIGNEE_STATUS_FOR_NON_MEMBER',
        );
      }

      // 2. 檢查現有的指派紀錄
      const assignee = await tx.subTaskAssignee.findUnique({
        where: { subTaskId_assigneeId: { subTaskId, assigneeId: actorId } },
        select: { status: true },
      });

      // -----------------------------------------------------------
      // 3. 自動領取 (Claim) 邏輯：紀錄不存在且欲變更為 ACCEPTED
      // -----------------------------------------------------------
      if (!assignee) {
        if (next !== AssignmentStatus.ACCEPTED) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            subTaskId,
            'ASSIGNEE_STATUS_ILLEGAL_WITHOUT_ASSIGNMENT',
          );
        }

        await tx.subTaskAssignee.create({
          data: {
            subTaskId,
            assigneeId: actorId,
            assignedById: actorId,
            status: AssignmentStatus.ACCEPTED,
            assignedAt: new Date(),
            acceptedAt: new Date(),
          },
        });

        this.notifyTaskChange(
          subTask.task.id,
          actorId,
          updatedBy!,
          'SUBTASK_CLAIMED',
        );

        return { ok: true };
      }

      // -----------------------------------------------------------
      // 4. 狀態轉換合法性檢查 (State Machine)
      // -----------------------------------------------------------
      const prev = assignee.status;
      const isLegal = this.checkStatusTransition(prev, next, subTask.status);

      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // -----------------------------------------------------------
      // 5. 執行更新
      // -----------------------------------------------------------
      const updateData = this.getAssigneeUpdateData(next, actorId, reason);

      await tx.subTaskAssignee.update({
        where: { subTaskId_assigneeId: { subTaskId, assigneeId: actorId } },
        data: updateData,
      });

      return { ok: true };
    });
  }

  // ------------------ Assign task -------------------

  async assignTask(payload: AssignTaskPayload) {
    const assignment = await this.handleAssignment({
      type: 'TASK',
      targetId: payload.id,
      assigneeId: payload.assigneeId,
      assignerId: payload.assignerId,
      sendUrgentEmail: payload.sendUrgentEmail,
    });

    this.notifyTaskChange(
      payload.id,
      payload.assignerId,
      payload.updatedBy!,
      'ASSIGNMENT_UPDATED',
    );

    return assignment;
  }

  async assignSubTask(payload: AssignTaskPayload) {
    return this.handleAssignment({
      type: 'SUBTASK',
      targetId: payload.id,
      assigneeId: payload.assigneeId,
      assignerId: payload.assignerId,
      sendUrgentEmail: payload.sendUrgentEmail,
    });
  }

  private async handleAssignment(options: InternalAssignOptions) {
    const { type, targetId, assigneeId, assignerId, sendUrgentEmail } = options;

    // 1. 統一獲取基礎資訊與校驗群組
    let groupId: number;
    let title: string;
    let priority: number;
    let description: string | null;
    let dueAt: Date | null;
    let redirectTaskId: number;

    if (type === 'TASK') {
      const task = await this.prismaService.task.findUnique({
        where: { id: targetId, status: TaskStatus.OPEN },
        select: {
          groupId: true,
          title: true,
          priority: true,
          description: true,
          dueAtUtc: true,
        },
      });
      if (!task || !task.groupId)
        throw TasksErrors.TaskNotFoundError.byId(assignerId, targetId);

      groupId = task.groupId;
      title = task.title;
      priority = task.priority;
      description = task.description;
      dueAt = task.dueAtUtc;
      redirectTaskId = targetId;
    } else {
      const sub = await this.prismaService.subTask.findUnique({
        where: { id: targetId, status: TaskStatus.OPEN },
        include: { task: { select: { id: true, groupId: true } } },
      });
      if (!sub || !sub.task.groupId)
        throw TasksErrors.TaskNotFoundError.byId(assignerId, targetId);

      groupId = sub.task.groupId;
      title = sub.title;
      priority = sub.priority;
      description = sub.description;
      dueAt = sub.dueAtUtc;
      redirectTaskId = sub.task.id;
    }

    // 2. 權限檢查 (指派者)
    const assigner = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: assignerId } },
      include: {
        user: { select: { name: true } },
        group: { select: { name: true } },
      },
    });

    if (!assigner || assigner.role === GroupRole.MEMBER) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        assignerId,
        targetId,
        'ONLY_ADMINISH_CAN_ASSIGN_TASKS',
      );
    }

    // 3. 檢查被指派者
    const isAssigneeMember = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: assigneeId } },
    });
    if (!isAssigneeMember)
      throw TasksErrors.TaskNotFoundError.byId(assignerId, targetId);

    // 4. 執行 Upsert
    const targetStatus =
      assigneeId === assignerId
        ? AssignmentStatus.ACCEPTED
        : AssignmentStatus.PENDING;

    let assignment;
    if (type === 'TASK') {
      assignment = await this.prismaService.taskAssignee.upsert({
        where: { taskId_assigneeId: { taskId: targetId, assigneeId } },
        update: {
          assignedById: assignerId,
          status: AssignmentStatus.PENDING,
          updatedAt: new Date(),
        },
        create: {
          taskId: targetId,
          assigneeId,
          assignedById: assignerId,
          status: AssignmentStatus.PENDING,
        },
      });
    } else {
      assignment = await this.prismaService.subTaskAssignee.upsert({
        where: { subTaskId_assigneeId: { subTaskId: targetId, assigneeId } },
        update: {
          assignedById: assignerId,
          status: targetStatus,
          updatedAt: new Date(),
        },
        create: {
          subTaskId: targetId,
          assigneeId,
          assignedById: assignerId,
          status: targetStatus,
        },
      });
    }

    // 5. 郵件通知
    if (sendUrgentEmail) {
      const assigneeUser = await this.prismaService.user.findUnique({
        where: { id: assigneeId },
        select: { email: true, name: true },
      });

      if (assigneeUser?.email) {
        const taskUrl =
          type === 'TASK'
            ? `${this.config.get('BASE_URL')}tasks/${targetId}`
            : `${this.config.get('BASE_URL')}tasks/${redirectTaskId}/sub-tasks/${targetId}`;

        await this.mailService.sendTaskAssignNotification({
          assigneeId,
          assigneeName: assigneeUser.name,
          email: assigneeUser.email,
          assignerName: assigner.user.name,
          taskId: type === 'TASK' ? targetId : redirectTaskId,
          subTaskId: type === 'SUBTASK' ? targetId : undefined,
          groupName: assigner.group.name,
          taskTitle: title,
          priority: this.mapPriorityToString(priority),
          dueAt: dueAt || null,
          description: description || 'No description provided.',
          taskUrl,
        });
      }
    }

    return assignment;
  }

  // ------------- Notifications --------------------

  async getPendingNotifications(userId: number) {
    const [tasks, subTasks] = await Promise.all([
      this.prismaService.taskAssignee.findMany({
        where: { assigneeId: userId, status: AssignmentStatus.PENDING },
        orderBy: { task: { priority: 'asc' } },
        take: 20,
        include: {
          task: {
            select: {
              id: true,
              priority: true,
              title: true,
              dueAtUtc: true,
              group: { select: { name: true } },
            },
          },
        },
      }),
      this.prismaService.subTaskAssignee.findMany({
        where: { assigneeId: userId, status: AssignmentStatus.PENDING },
        orderBy: { subtask: { priority: 'asc' } },
        take: 20,
        include: {
          subtask: {
            select: {
              id: true,
              priority: true,
              title: true,
              dueAtUtc: true,
              task: {
                select: {
                  id: true, // 子任務需要連回父任務的 ID 才能產生正確連結
                  group: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    // 扁平化處理
    const formattedTasks = tasks.map((t) => ({
      id: t.task.id,
      type: 'TASK',
      title: t.task.title,
      priority: t.task.priority,
      dueAt: t.task.dueAtUtc,
      groupName: t.task.group?.name || 'Personal',
      url: `/tasks/${t.task.id}`,
    }));

    const formattedSubTasks = subTasks.map((st) => ({
      id: st.subtask.id,
      type: 'SUBTASK',
      title: `[Sub] ${st.subtask.title}`,
      priority: st.subtask.priority,
      dueAt: st.subtask.dueAtUtc,
      groupName: st.subtask.task.group?.name || 'Personal',
      url: `/tasks/${st.subtask.task.id}`, // 通常連結到父任務詳情頁
    }));

    // 合併並根據優先級排序 (1 最高)
    return [...formattedTasks, ...formattedSubTasks]
      .sort((a, b) => {
        // 1. 先比較優先級 (Priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        // 2. 如果優先級相同，比較截止日期 (dueAt)
        // 處理 null 的情況：將沒有時間的任務設為極大值（排到最後）
        const timeA = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const timeB = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;

        return timeA - timeB;
      })
      .slice(0, 20);
  }

  async processEmailResponse(
    token: string,
    status: AssignmentStatus,
  ): Promise<{ taskId: number; subTaskId?: number }> {
    // 1. 驗證並解密 Token
    // 這裡建議在 AuthService 寫一個專門驗證 TaskToken 的方法
    const payload = await this.securityService.verifyTaskActionToken(token);

    if (payload.subTaskId) {
      await this.updateSubTaskAssigneeStatus(
        payload.subTaskId,
        payload.userId,
        {
          status,
        },
      );
      return { taskId: payload.taskId, subTaskId: payload.subTaskId };
    }

    // 2. 執行原本的更新邏輯
    await this.updateAssigneeStatus(payload.taskId, payload.userId, {
      status,
    });

    return { taskId: payload.taskId };
  }

  //  ----------------- Common helper -----------------

  getCommonUpdateData<T extends TaskModelFields | SubTaskModelFields>(
    payload: TaskUpdatePayload,
    timeZone: string,
  ): T {
    const data: any = {};

    if (payload['title'] !== undefined) {
      data['title'] = payload.title;
    }
    if (payload['description'] !== undefined) {
      data['description'] = payload.description;
    }
    if (payload['location'] !== undefined) {
      data['location'] = payload.location;
    }
    if (payload['priority'] !== undefined) {
      data['priority'] = payload.priority;
    }

    // 處理時間邏輯
    if (payload.allDay) {
      data['allDay'] = true;
      data['allDayLocalDate'] = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
      data['dueAtUtc'] = null;
    } else if (payload.allDay === undefined || payload.allDay === false) {
      // 確保只在 explicit false 時執行
      if (payload.dueDate && payload.dueTime) {
        data['allDay'] = false;
        const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
        // 假設 fromZonedTime 存在並能正確轉換
        data['dueAtUtc'] = fromZonedTime(localISO, timeZone);
        data['allDayLocalDate'] = null;
      }
    }

    // 可以在這裡處理 sourceTimeZone，但如果 payload 沒傳，則保持不變

    return data as T;
  }

  private getAssigneeUpdateData(
    next: AssignmentStatus,
    actorId: number,
    reason?: string,
  ) {
    const data: any = { status: next };
    const now = new Date();

    if (next === AssignmentStatus.ACCEPTED) {
      data.acceptedAt = now;
      data.declinedAt = null;
      data.completedAt = null;
      data.assignedById = actorId; // 更新指派人為領取者
    } else if (next === AssignmentStatus.DECLINED) {
      data.declinedAt = now;
      data.completedAt = null;
      data.reason = reason ?? null;
    } else if (next === AssignmentStatus.COMPLETED) {
      data.completedAt = now;
    } else if (next === AssignmentStatus.PENDING) {
      data.acceptedAt = null;
      data.declinedAt = null;
      data.completedAt = null;
      data.reason = null;
    }
    return data;
  }

  private checkStatusTransition(
    prev: AssignmentStatus,
    next: AssignmentStatus,
    taskStatus: string,
  ): boolean {
    if (prev === next) return true;

    const transitions: Record<AssignmentStatus, AssignmentStatus[]> = {
      [AssignmentStatus.PENDING]: [
        AssignmentStatus.ACCEPTED,
        AssignmentStatus.DECLINED,
        AssignmentStatus.SKIPPED, // 🚨 新增：可被 Admin 結案為跳過
      ],
      [AssignmentStatus.ACCEPTED]: [
        AssignmentStatus.COMPLETED,
        AssignmentStatus.DECLINED,
        AssignmentStatus.PENDING,
        AssignmentStatus.DROPPED, // 🚨 新增：執行中被 Admin 終止
      ],
      [AssignmentStatus.DECLINED]: [
        AssignmentStatus.ACCEPTED,
        AssignmentStatus.PENDING,
      ],
      [AssignmentStatus.COMPLETED]:
        taskStatus === 'OPEN' ? [AssignmentStatus.ACCEPTED] : [],

      // 🚨 新增終端狀態：通常不允許從這些狀態再往外跳
      [AssignmentStatus.SKIPPED]: [],
      [AssignmentStatus.DROPPED]: [],
    };

    return transitions[prev]?.includes(next) ?? false;
  }

  private mapPriorityToString(priority: number): string {
    const map = {
      1: 'URGENT',
      2: 'HIGH',
      3: 'MEDIUM',
      4: 'LOW',
    };
    return map[priority];
  }

  private async notifyTaskChange(
    taskId: number,
    actorId: number,
    updatedBy: string,
    type: string,
  ) {
    this.tasksGateway.broadcastTaskUpdate(taskId, {
      type,
      taskId,
      updatedBy,
      actorId,
    });
  }

  private getSortOrder(order?: Order): any {
    // 如果是 undefined 或 'desc' 就回傳 DESC，否則回傳 ASC
    return order === Order.ASC ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  }
}
