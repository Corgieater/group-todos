import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  SubTaskAddPayload,
  TasksAddPayload,
  TaskUpdatePayload,
  TaskWithAssignees,
  UpdateStatusOpts,
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

@Injectable()
export class TasksService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
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

  async getAllFutureTasks(
    userId: number,
    timeZone: string,
  ): Promise<TaskModel[]> {
    await this.usersService.findByIdOrThrow(userId);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { startUtc, endUtc: _endUtc } = dayBoundsUtc(timeZone, tomorrow);

    return this.prismaService.$queryRaw<TaskModel[]>`
    SELECT *
    FROM "Task"
    WHERE "ownerId" = ${userId}
      AND "status" = 'OPEN'
      AND (
        "dueAtUtc" > ${startUtc}
        OR "allDayLocalDate" > ${startUtc}
      )
    ORDER BY COALESCE("dueAtUtc", "allDayLocalDate") ASC
  `;
  }

  async getTaskForViewer(
    id: number,
    actorId: number,
  ): Promise<{ task: TaskWithAssignees; isAdminish: boolean }> {
    const base = await this.prismaService.task.findUnique({
      where: { id },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!base) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    if (!base.groupId) {
      // personal task
      if (base.ownerId !== actorId) {
        throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      }
      // 個人任務直接補上 assignees（通常為空陣列）
      const task = await this.prismaService.task.findUnique({
        where: { id },
        include: {
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              assignedBy: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
      // 理論上不會是 null，但保險處理
      if (!task) {
        throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      }
      return { task, isAdminish: true };
    }

    // group task：檢查成員與角色
    const member = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId: base.groupId, userId: actorId } },
      select: { role: true },
    });
    if (!member) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }
    const ADMINISH = new Set<GroupRole>([GroupRole.ADMIN, GroupRole.OWNER]);
    const isAdminish = ADMINISH.has(member.role);

    // 取完整 task + assignees
    const task = await this.prismaService.task.findUnique({
      where: { id },
      include: {
        assignees: {
          orderBy: { acceptedAt: 'asc' }, // 可選
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            assignedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    return { task, isAdminish };
  }

  async getTasksByStatus(
    ownerId: number,
    status: TaskStatus,
  ): Promise<TaskModel[]> {
    const { items } = await this.listTaskCore(
      { kind: 'owner', ownerId },
      { status: [status] },
      'createdAsc',
    );
    return items;
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
    return await this.listTaskCore(
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
    const data: Prisma.TaskUpdateInput = {};

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

    if (payload.allDay) {
      data['allDay'] = true;
      data['allDayLocalDate'] = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
      data['dueAtUtc'] = null;
    } else if (!payload.allDay) {
      if (payload.dueDate && payload.dueTime) {
        data['allDay'] = false;
        const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
        data['dueAtUtc'] = fromZonedTime(localISO, user.timeZone);
        data['allDayLocalDate'] = null;
      }
    }

    try {
      const task = await this.prismaService.task.update({
        where: { id, ownerId: userId },
        data,
      });
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

  ALLOWED: Record<AssignmentStatus, AssignmentStatus[]> = {
    PENDING: [AssignmentStatus.ACCEPTED, AssignmentStatus.DECLINED],
    ACCEPTED: [AssignmentStatus.COMPLETED, AssignmentStatus.DECLINED],
    DECLINED: [AssignmentStatus.ACCEPTED],
    COMPLETED: [],
  };

  async updateAssigneeStatus(
    id: number,
    actorId: number,
    dto: { status: AssignmentStatus; reason?: string },
  ) {
    const { status: next, reason } = dto;

    return this.prismaService.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        select: { id: true, groupId: true, status: true },
      });
      if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      if (!task.groupId)
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'ASSIGNEE_STATUS_FOR_PERSONAL_TASK',
        );

      const member = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId, userId: actorId } },
        select: { userId: true },
      });
      if (!member)
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'ASSIGNEE_STATUS_FOR_NON_MEMBER',
        );

      const assignee = await tx.taskAssignee.findUnique({
        where: { taskId_assigneeId: { taskId: task.id, assigneeId: actorId } },
        select: {
          status: true,
          acceptedAt: true,
          declinedAt: true,
          completedAt: true,
        },
      });

      // 自我指派：不存在記錄且想 Accept → 建一筆
      if (!assignee) {
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
            status: AssignmentStatus.ACCEPTED,
            assignedAt: new Date(),
            acceptedAt: new Date(),
          },
        });
        return { ok: true };
      }

      const prev = assignee.status;
      const allow = (from: AssignmentStatus, tos: AssignmentStatus[]) =>
        prev === from && tos.includes(next);

      const legal =
        allow(AssignmentStatus.PENDING, [
          AssignmentStatus.ACCEPTED,
          AssignmentStatus.DECLINED,
        ]) ||
        allow(AssignmentStatus.ACCEPTED, [
          AssignmentStatus.COMPLETED,
          AssignmentStatus.DECLINED,
          AssignmentStatus.PENDING,
        ]) ||
        allow(AssignmentStatus.DECLINED, [
          AssignmentStatus.ACCEPTED,
          AssignmentStatus.PENDING,
        ]) ||
        // Completed -> Accepted（只在任務仍 OPEN）
        (prev === AssignmentStatus.COMPLETED &&
          next === AssignmentStatus.ACCEPTED &&
          task.status === 'OPEN');

      if (!legal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          task.id,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // 時間欄位的更新規則
      const data: any = { status: next };
      if (next === AssignmentStatus.ACCEPTED) {
        data.acceptedAt = new Date();
        // 可能是從 DECLINED/COMPLETED 退回
        data.declinedAt = null;
        data.completedAt = null;
      } else if (next === AssignmentStatus.DECLINED) {
        data.declinedAt = new Date();
        data.completedAt = null;
        // 保留 acceptedAt（歷史曾接受）或視需求清空；這裡保留
        data.reason = reason ?? null;
      } else if (next === AssignmentStatus.COMPLETED) {
        data.completedAt = new Date();
      } else if (next === AssignmentStatus.PENDING) {
        // 回到待決 → 清空三個時間與理由
        data.acceptedAt = null;
        data.declinedAt = null;
        data.completedAt = null;
        data.reason = null;
      }

      await tx.taskAssignee.update({
        where: { taskId_assigneeId: { taskId: task.id, assigneeId: actorId } },
        data,
      });

      return { ok: true };
    });
  }

  async closeTask(
    id: number,
    actorId: number,
    opts?: { force?: boolean; reason?: string },
  ) {
    return this.updateTaskStatus(id, {
      target: TaskStatus.CLOSED,
      actorId,
      force: opts?.force,
      reason: opts?.reason ?? null,
    });
  }

  async archiveTask(id: number, actorId: number) {
    return this.updateTaskStatus(id, { target: TaskStatus.ARCHIVED, actorId });
  }

  async restoreTask(id: number, actorId: number) {
    return this.updateTaskStatus(id, { target: TaskStatus.OPEN, actorId });
  }

  async updateTaskStatus(id: number, opts: UpdateStatusOpts): Promise<void> {
    const { target, actorId, force, reason } = opts;

    return this.prismaService.$transaction(async (tx) => {
      // 1) 取基本資料
      const task = await tx.task.findUnique({
        where: { id },
        select: {
          id: true,
          ownerId: true,
          groupId: true,
          status: true,
          assignees:
            target === TaskStatus.CLOSED ? { select: { status: true } } : false,
        },
      });
      if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

      // 2) 權限（owner 永遠可以；群組任務需 OWNER/ADMIN）
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

      // 3) 狀態轉移規則
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

      // 4) 僅在「關閉群組任務」時套完成度規則
      let closedWithOpenAssignees = false;
      let closedReason: string | null = null;

      if (target === TaskStatus.CLOSED && task.groupId !== null) {
        const assignees = task.assignees ?? [];
        const total = assignees.length;
        const completed = assignees.filter(
          (a) => a.status === AssignmentStatus.COMPLETED,
        ).length;

        const noneCompleted = total > 0 ? completed === 0 : true; // 沒 assignee 視為 0 完成
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

      // 5) 審計欄位與更新資料
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
      include: {
        assignees: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    const mapped = items.map((t) => ({
      ...t,
      assignees: (t.assignees ?? []).map((a) => ({
        id: a.assignee.id,
        name: a.assignee.name,
        email: a.assignee.email,
        status: a.status,
      })),
    }));

    return {
      items: mapped,
      bounds: { timeZone, startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc },
    };
  }

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
        select: { role: true },
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
  }

  async getSubTasksByParentTaskId(
    parentTaskId: number,
    actorId: number,
  ): Promise<SubTask[]> {
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: parentTaskId },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, parentTaskId);
    }

    // Personal task，只有 owner 可以查看子任務
    if (!parentTask.groupId) {
      if (parentTask.ownerId !== actorId) {
        throw TasksErrors.TaskNotFoundError.byId(actorId, parentTaskId);
      }
    } else {
      // Group task，檢查成員與角色
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
        throw TasksErrors.TaskNotFoundError.byId(actorId, parentTaskId);
      }
    }

    const subTasks = await this.prismaService.subTask.findMany({
      where: { taskId: parentTaskId },
    });

    return subTasks;
  }
}
