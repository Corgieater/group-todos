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
  ListTasksResult,
} from './types/tasks';
import {
  AssignmentStatus,
  GroupRole,
  Prisma,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import type { SubTask, Task } from 'src/generated/prisma/client';
import { TaskStatus } from './types/enum';
import { GroupsErrors, TasksErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/mail/mail.service';
import { SecurityService } from 'src/security/security.service';
import { TasksGateWay } from './tasks.gateway';
import { PageDto } from 'src/common/dto/page.dto';
import { PageMetaDto } from 'src/common/dto/page-meta.dto';
import { CurrentUser } from 'src/common/types/current-user';

type DueFilter = 'TODAY' | 'NONE' | 'EXPIRED' | 'RANGE';

type ListTasksScope =
  | { kind: 'owner'; ownerId: number }
  | { kind: 'group'; groupId: number; viewerId: number };

type ListTasksFilters = {
  status?: TaskStatus[]; // Default ['UNFINISHED']
  due?: DueFilter[]; // Example：['TODAY','NONE'] / ['EXPIRED']
  range?: { startUtc: Date; endUtc: Date }; // When due day includes range
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
    const userTz = user.timeZone || 'UTC';

    let dueAtUtc: Date | null = null;
    let allDayLocalDate: Date | null = null;

    // --- 核心邏輯修正 ---
    if (payload.allDay) {
      // 全天任務：只存 LocalDate
      allDayLocalDate = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
      dueAtUtc = null;
    } else if (payload.dueDate) {
      // 非全天任務：只要有日期，沒時間就預設 00:00
      const timePart = payload.dueTime || '00:00';
      const localISO = `${payload.dueDate}T${timePart}:00`;
      dueAtUtc = fromZonedTime(localISO, userTz);
      allDayLocalDate = null;
    }

    // --- 構建資料物件 ---
    const data: Prisma.TaskCreateInput = {
      title: payload.title,
      description: payload.description,
      location: payload.location,
      status: payload.status || 'OPEN',
      priority: payload.priority ? Number(payload.priority) : 3,
      allDay: !!payload.allDay,
      dueAtUtc,
      allDayLocalDate,
      // 建立關聯
      owner: { connect: { id: user.id } },
      ...(groupId && { group: { connect: { id: groupId } } }),
    };

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
    /**
     * Retrieves a paginated list of tasks for the listing page.
     * * This method dynamically constructs a raw SQL query based on the provided filters.
     * It calculates "Future" task boundaries based on the user's timezone and includes
     * sub-query counts for open sub-tasks and active assignees.
     *
     * @param userId - The ID of the user who owns the tasks.
     * @param timeZone - The user's IANA timezone (e.g., 'UTC', 'Asia/Taipei') used for "Tomorrow" boundary calculations.
     * @param options - Configuration for pagination and filtering.
     * @param options.status - Filter by task status (e.g., 'OPEN', 'CLOSED', 'ARCHIVED').
     * @param options.scope - Time scope filter. Currently only supports 'FUTURE'.
     * @param options.page - The current page number (1-based index). Default: 1.
     * @param options.limit - Number of items per page. Maximum: 20. Default: 10.
     * @param options.order - Sorting order based on creation time ('ASC' or 'DESC'). Default: 'DESC'.
     * * @returns A PageDto containing the list of tasks and pagination metadata.
     */
    const { status, scope, page = 1, limit = 10, order = 'DESC' } = options;
    const skip = (page - 1) * limit;

    // 1. Deal with time boundary (espacially for future)
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { startUtc } = dayBoundsUtc(timeZone, tomorrow);

    // 2. Build where conditions dynamically
    // Use Prisma.sql in case SQL injection
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

    // 3. Execution data inquiry and total stats
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

    // 4. Build pagination Meta
    const itemCount = Number(totalResult[0]?.count ?? 0);
    const pageOptionsDto = { page, limit, skip }; // 模擬 PageOptionsDto 結構
    const meta = new PageMetaDto(pageOptionsDto as any, itemCount);

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
    /**
     * Retrieves detailed task information for a specific viewer.
     * * This method performs several key operations:
     * 1. Validates task existence and viewer access rights.
     * 2. Fetches full task details, including nested assignees and sub-tasks.
     * 3. Calculates 'isAdminish' status to determine if the viewer has administrative
     * privileges (e.g., assigning tasks, managing group settings).
     * 4. Evaluates if the task is eligible to be closed based on sub-task status.
     * 5. Compiles a list of group members available for task assignment.
     *
     * @param id - The unique identifier of the task.
     * @param actorId - The ID of the user requesting the task details (the viewer).
     * * @returns An object containing:
     * - `task`: The comprehensive task entity with nested relations.
     * - `isAdminish`: Boolean flag for administrative permissions.
     * - `canClose`: Boolean flag indicating if all sub-tasks are completed.
     * - `groupMembers`: A list of potential assignees within the group context.
     */

    // Base query for checking if task really exists
    const base = await this.prismaService.task.findUnique({
      where: { id },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!base) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // Role check: personal task only review to Owner
    if (!base.groupId && base.ownerId !== actorId) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // --- Core query: Including Task Assignees, SubTasks and Assignees
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

    // Get group members for assign member drop list
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

    // Check if this task can be closed or not
    const hasOpenSubTasks = (task.subTasks || []).some(
      (st) => st.status !== TaskStatus.CLOSED,
    );
    const canClose = !hasOpenSubTasks;

    let isAdminish = false;

    // Check if viewer is adminish, this will affect certain actions like task assigning
    if (!base.groupId) {
      isAdminish = true;
    } else {
      const member = await this.prismaService.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId!, userId: actorId } },
        select: { role: true },
      });
      // const ADMINISH = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
      // isAdminish = ADMINISH.has(member!.role);
      isAdminish = this.isAdminish(member!.role);
    }

    return {
      task: task as TaskWithAllDetails,
      isAdminish,
      canClose,
      groupMembers,
    };
  }

  async getHomeDashboardData(user: CurrentUser) {
    /**
     * Retrieves an aggregated dataset for the user's home dashboard.
     * * This method performs three parallel queries to fetch tasks across
     * different time-based scopes (EXPIRED, TODAY, and NONE). It uses
     * predefined limits to ensure the dashboard remains performant and focused.
     *
     * @param user - The current authenticated user requesting the dashboard.
     * * @returns An aggregated object containing:
     * - `expired`: A prioritized list of past-due tasks (up to 5).
     * - `today`: Tasks due within the current day (up to 15).
     * - `none`: Tasks with no due date assigned (up to 10).
     * - `bounds`: The timezone-specific time boundaries used for "Today" calculations.
     */

    // Define limits for each time scope
    const LIMITS = { EXPIRED: 5, TODAY: 15, NONE: 10 };

    // Get each time scopre from listTaskCore
    const [expiredRes, todayRes, noneRes] = await Promise.all([
      this.listTaskCore(
        { kind: 'owner', ownerId: user.userId },
        user.timeZone,
        { status: ['OPEN'], due: ['EXPIRED'] },
        'expiredPriority',
        LIMITS.EXPIRED,
      ),
      this.listTaskCore(
        { kind: 'owner', ownerId: user.userId },
        user.timeZone,
        { status: ['OPEN'], due: ['TODAY'] },
        'dueAtAscNullsLast',
        LIMITS.TODAY,
      ),
      this.listTaskCore(
        { kind: 'owner', ownerId: user.userId },
        user.timeZone,
        { status: ['OPEN'], due: ['NONE'] },
        'createdAsc',
        LIMITS.NONE,
      ),
    ]);

    return {
      expired: expiredRes.items,
      today: todayRes.items,
      none: noneRes.items,
      bounds: todayRes.bounds,
    };
  }

  async getGroupDashboardData(groupId: number, viewer: CurrentUser) {
    const LIMITS = { EXPIRED: 5, TODAY: 15, NONE: 10 };

    const [expiredRes, todayRes, noneRes] = await Promise.all([
      this.listTaskCore(
        { kind: 'group', groupId, viewerId: viewer.userId },
        viewer.timeZone,
        { status: ['OPEN'], due: ['EXPIRED'] },
        'expiredPriority',
        LIMITS.EXPIRED,
      ),
      this.listTaskCore(
        { kind: 'group', groupId, viewerId: viewer.userId },
        viewer.timeZone,
        { status: ['OPEN'], due: ['TODAY'] },
        'dueAtAscNullsLast',
        LIMITS.TODAY,
      ),
      this.listTaskCore(
        { kind: 'group', groupId, viewerId: viewer.userId },
        viewer.timeZone,
        { status: ['OPEN'], due: ['NONE'] },
        'createdAsc',
        LIMITS.NONE,
      ),
    ]);

    return {
      expired: expiredRes.items,
      today: todayRes.items,
      none: noneRes.items,
      bounds: todayRes.bounds,
    };
  }

  async updateTask(
    id: number,
    userId: number,
    payload: TaskUpdatePayload,
  ): Promise<TaskModel> {
    /**
     * Updates an existing task's attributes based on the provided payload.
     * * This method retrieves the user's settings (e.g., timezone) to ensure
     * date-related updates are correctly converted to UTC. It also triggers
     * a notification after a successful update.
     *
     * @param id - The unique identifier of the task to be updated.
     * @param userId - The ID of the actor performing the update (used for permissions and notifications).
     * @param payload - An object containing the task fields to update (description, dueDate, etc.).
     * * @returns {Promise<TaskModel>} The updated task record.
     * * @throws {TaskNotFoundError}
     * Thrown if the task does not exist or if the update violates unique constraints.
     */
    const user = await this.usersService.findByIdOrThrow(userId);

    const commonData = this.getCommonUpdateData<Prisma.TaskUpdateInput>(
      payload,
      user.timeZone,
    );

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

  // assign task, slef-assign, claim
  async updateAssigneeStatus(
    id: number,
    actorId: number,
    dto: { status: AssignmentStatus; reason?: string },
    updatedBy: string | null = null,
  ) {
    /**
     * Updates the assignment status for a user on a specific task.
     * * This method handles three core business scenarios:
     * 1. **Claiming (Self-Assign)**: If no assignment record exists and status is 'ACCEPTED',
     * it creates a new record.
     * 2. **Declining**: Transitions a 'PENDING' assignment to 'DECLINED' (requires a reason).
     * 3. **Progress Tracking**: Transitions between 'ACCEPTED', 'COMPLETED', or 'CLOSED'
     * based on the user's progress.
     *
     * @param id - The unique identifier of the Task.
     * @param actorId - The ID of the user performing the update.
     * @param dto - Data transfer object containing:
     * - `status`: Target AssignmentStatus (e.g., ACCEPTED, DECLINED).
     * - `reason`: Optional string, mandatory when declining a task.
     * @param updatedBy - The display name of the actor for WebSocket notifications.
     * * @throws {TasksErrors.TaskNotFoundError} If the task ID does not exist.
     * @throws {TasksErrors.TaskForbiddenError}
     * - If the task is a Personal Task (assignments only allowed for Group Tasks).
     * - If the actor is not a member of the group associated with the task.
     * - If the status transition is illegal (e.g., moving from 'CLOSED' back to 'PENDING').
     * - If attempting to update a non-existent assignment with a status other than 'ACCEPTED'.
     * * @returns A promise that resolves to { ok: true } upon successful update.
     */

    const { status: next, reason } = dto;

    return this.prismaService.$transaction(async (tx) => {
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

      // Check if really a group task
      if (!task.groupId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'ASSIGNEE_STATUS_FOR_PERSONAL_TASK',
        );
      }

      // Check if actor is a member of group
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

      // 2. Handle self claim logic
      if (!currentAssignee) {
        // If user not been assigned to the task, they can only change
        // assigneeStatus to ACCEPTED (self claim a task)
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

      // 3. Check if Assignee.status logic is correct
      // (example: DECLINED -> ACCEPTED is allowed, but CLOSED -> PENDING is not)
      const prev = currentAssignee.status;
      const isLegal = this.checkStatusTransition(prev, next, task.status);

      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // 4. update
      const updateData = this.getAssigneeUpdateData(next, actorId, reason);

      await tx.taskAssignee.update({
        where: { taskId_assigneeId: { taskId: task.id, assigneeId: actorId } },
        data: updateData,
      });

      // Notification for frontend
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
    opts?: { reason?: string },
  ): Promise<Task> {
    /**
     * Closes a task. If already closed, returns the existing record.
     * * @param id - The Task unique ID.
     * @param actorId - The user performing the close action.
     * @param opts - Options like closure reason.
     * * @returns {Promise<Task>} The updated or existing closed Task object.
     * @throws {TasksErrors.TaskNotFoundError} If the task does not exist.
     * @throws {TasksErrors.TaskForbiddenError} If forced close is attempted without a reason.
     */

    // 1. Get task with all needed info
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

    if (task.status === TaskStatus.CLOSED) {
      return await this.prismaService.task.findUniqueOrThrow({ where: { id } });
    } // If closed, just return task

    // 2. Check if subTasks under the task are all complete
    const hasOpenItems = task._count.subTasks > 0 || task._count.assignees > 0;

    // 3. If there are incompleted subTasks and no close reason, throw error
    if (hasOpenItems && !opts?.reason) {
      // Return specific error for frontend to catch and pop-up
      // a reason winddow for user to input
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        'FORCE_CLOSE_REASON_REQUIRED',
      );
    }

    // 4. Update and close a task
    return this.prismaService.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          closedById: actorId,
          closedReason: opts?.reason ?? null,
          //Key: Mark if this is an 'incompleted' task if there is subTask still opened
          closedWithOpenAssignees: hasOpenItems,
        },
      });

      // A. Deal with user with ACCEPTED assignmentStatus.
      // Change the status to DROPPED.
      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.DROPPED, updatedAt: new Date() },
      });

      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.PENDING },
        data: { status: AssignmentStatus.SKIPPED, updatedAt: new Date() },
      });

      // B. Close all the subTasks that not done.
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

  async archiveTask(id: number, actorId: number): Promise<void> {
    /**
     * Archives a specific task and all its associated sub-tasks.
     * * @description
     * This method executes within a database transaction to ensure atomicity:
     * 1. Updates the parent Task status to 'ARCHIVED' using the internal status manager.
     * 2. Performs a cascading update on all child SubTasks that are not yet archived.
     * * @param id - The unique identifier of the Task to be archived.
     * @param actorId - The ID of the user performing the archive action.
     * @throws {TasksErrors.TaskNotFoundError} If the parent task does not exist.
     * @throws {TasksErrors.TaskForbiddenError} If the actor lacks sufficient permissions.
     * @returns {Promise<void>} Resolves when both parent and child entities are successfully archived.
     */
    return this.prismaService.$transaction(async (tx) => {
      // 1. Update parent Task
      await this.updateTaskStatus(
        id,
        {
          target: TaskStatus.ARCHIVED,
          actorId,
        },
        tx,
      );

      // 2. Archive subTasks belong to this parent Task
      await tx.subTask.updateMany({
        where: {
          taskId: id,
          status: { not: TaskStatus.ARCHIVED }, // Only update those are not archived
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });
  }

  async restoreTask(id: number, actorId: number): Promise<void> {
    /**
     * Restores a task and its archived sub-tasks back to 'OPEN' status.
     * * @description
     * 1. Authorization:
     * - Personal Tasks: Only the owner can restore.
     * - Group Tasks: Only users with OWNER or ADMIN roles can restore.
     * 2. Audit Reset: Clears 'closedAt' and 'closedById' fields.
     * 3. Cascade: Specifically restores sub-tasks that were previously 'ARCHIVED'.
     * * @param id - Task ID to be restored.
     * @param actorId - The user ID initiating the request.
     * @throws {TasksErrors.TaskNotFoundError} If task doesn't exist or ownership is violated.
     * @throws {GroupsErrors.NotAuthorizedToUpdateTasksStatusError} If group permissions are insufficient.
     * @returns {Promise<void>}
     */

    const task = await this.prismaService.task.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        group: {
          select: {
            id: true,
            members: {
              where: { userId: actorId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // --- Authorization Logic ---
    if (!task.group) {
      // Case 1: Personal Task - Only owner can restore
      if (task.ownerId !== actorId) {
        throw TasksErrors.TaskNotFoundError.byId(actorId, id); // Use NotFound to prevent ID leaking
      }
    } else {
      // Case 2: Group Task - Check member role
      const member = task.group.members[0]; // Since we filtered by userId, it will have 0 or 1 item

      if (!member || !this.isAdminish(member.role)) {
        const role = member?.role || null;
        throw GroupsErrors.GroupActionForbiddenError.updateTaskStatus(
          task.group.id,
          actorId,
          role,
        );
      }
    }

    // --- Execution Logic ---
    return this.prismaService.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      // We only restore subtasks that were ARCHIVED (to preserve originally CLOSED ones)
      await tx.subTask.updateMany({
        where: { taskId: id, status: TaskStatus.ARCHIVED },
        data: { status: TaskStatus.OPEN },
      });
    });
  }

  async updateTaskStatus(
    id: number,
    opts: UpdateStatusOpts,
    txHost?: Prisma.TransactionClient,
  ): Promise<void> {
    // 🚀 如果已經有外部事務 txHost，直接執行邏輯
    if (txHost) {
      return this.executeUpdateLogic(id, opts, txHost);
    }

    // 🚀 否則，開啟一個新的事務並執行邏輯
    return this.prismaService.$transaction(async (tx) => {
      return this.executeUpdateLogic(id, opts, tx);
    });
  }

  /**
   * Core internal logic for updating task status.
   * Designed to be executed within a Prisma Transaction.
   * * @param id - Task ID
   * @param opts - Update options (target status, actor, force flag, reason)
   * @param tx - The active Prisma Transaction Client
   */
  private async executeUpdateLogic(
    id: number,
    opts: UpdateStatusOpts,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const { target, actorId, force, reason } = opts;
    const isTargetClosed = target === TaskStatus.CLOSED;

    // -----------------------------------------------------------
    // 1) Unified Data Fetching
    // Fetches all necessary info (Task, SubTask status, Assignees) in ONE query.
    // -----------------------------------------------------------
    const task = await tx.task.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        groupId: true,
        status: true,
        // Only fetch relations if we are attempting to CLOSE the task
        assignees:
          isTargetClosed && true ? { select: { status: true } } : false,
        subTasks: isTargetClosed ? { select: { status: true } } : false,
      },
    });

    if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    // -----------------------------------------------------------
    // 2) Permission Validation
    // -----------------------------------------------------------
    let allowed = task.ownerId === actorId;

    // If not owner, check if user is an ADMIN/OWNER in the group
    if (!allowed && task.groupId !== null) {
      const member = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId, userId: actorId } },
        select: { role: true },
      });

      if (!member) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'UPDATE_STATUS_NOT_MEMBER',
        );
      }

      // const ADMIN_ROLES = new Set<GroupRole>([
      //   GroupRole.OWNER,
      //   GroupRole.ADMIN,
      // ]);
      // allowed = ADMIN_ROLES.has(member.role);
      allowed = this.isAdminish(member.role);
    }

    if (!allowed) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        'UPDATE_STATUS_FORBIDDEN',
      );
    }

    // -----------------------------------------------------------
    // 3) State Transition Rules (State Machine)
    // -----------------------------------------------------------
    const from = task.status;
    const isLegalTransition =
      (from === TaskStatus.OPEN &&
        (target === TaskStatus.CLOSED || target === TaskStatus.ARCHIVED)) ||
      (from === TaskStatus.CLOSED &&
        (target === TaskStatus.ARCHIVED || target === TaskStatus.OPEN)) ||
      (from === TaskStatus.ARCHIVED && target === TaskStatus.OPEN);

    if (!isLegalTransition) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        `ILLEGAL_TRANSITION_${from}_TO_${target}`,
      );
    }

    // -----------------------------------------------------------
    // 4) Completion Rules (SubTask & Assignee Validation)
    // -----------------------------------------------------------
    let closedWithOpenAssignees = false;
    let closedReason: string | null = null;

    if (isTargetClosed) {
      const subTasks = (task as any).subTasks ?? []; // Use type casting if necessary due to conditional select
      const hasSubTasks = subTasks.length > 0;

      if (hasSubTasks) {
        // Rule A: All subtasks MUST be closed to close the parent task
        const hasOpenSubTasks = subTasks.some(
          (st: any) => st.status !== TaskStatus.CLOSED,
        );
        if (hasOpenSubTasks) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            id,
            'CANNOT_CLOSE_TASK_WITH_OPEN_SUBTASKS',
          );
        }
      } else if (task.groupId !== null) {
        // Rule B: Group Task Assignee rules (Only if no subtasks exist)
        const assignees = (task as any).assignees ?? [];
        const total = assignees.length;
        const completedCount = assignees.filter(
          (a: any) => a.status === AssignmentStatus.COMPLETED,
        ).length;

        const noneCompleted = total > 0 ? completedCount === 0 : false;
        const someCompleted =
          total > 0 && completedCount > 0 && completedCount < total;

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
    }

    // -----------------------------------------------------------
    // 5) Execute Update
    // -----------------------------------------------------------
    const updateData: Prisma.TaskUpdateInput = { status: target };

    if (target === TaskStatus.CLOSED) {
      Object.assign(updateData, {
        closedAt: new Date(),
        closedById: actorId,
        closedReason,
        closedWithOpenAssignees,
      });
    } else if (target === TaskStatus.OPEN) {
      // Restore logic: Reset audit fields when reopening
      Object.assign(updateData, {
        closedAt: null,
        closedById: null,
        closedReason: null,
        closedWithOpenAssignees: false,
      });
    }

    await tx.task.update({ where: { id }, data: updateData });
  }

  // private async listTaskCore(
  //   scope: ListTasksScope,
  //   timeZone: string,
  //   filters: ListTasksFilters,
  //   orderByKey: OrderKey,
  //   take?: number,
  // ): Promise<ListTasksResult> {
  //   /**
  //    * Core logic for listing and filtering tasks.
  //    * * This method handles complex timezone-aware boundary calculations,
  //    * applies various due-date filters (TODAY, EXPIRED, NONE, RANGE),
  //    * and transforms raw database entities into DTOs containing calculated
  //    * business logic like the `canClose` flag.
  //    *
  //    * @param scope - Defines the visibility context: personal (owner) or group-based.
  //    * @param timeZone - The user's IANA timezone (e.g., 'UTC', 'Asia/Taipei') used for accurate "Today" calculations.
  //    * @param filters - Filtering criteria including status, due types, and custom date ranges.
  //    * @param orderByKey - Sorting strategy for the result set.
  //    * @param take - Maximum number of records to retrieve (for pagination).
  //    * * @returns {Promise<ListTasksResult>}
  //    */
  //   const status = filters.status ?? ['OPEN'];
  //   const { startUtc, endUtc, todayDateOnlyUtc } = this.getTaskBounds(timeZone);
  //   const due = new Set(filters.due ?? []);
  //   const OR: Prisma.TaskWhereInput[] = [];

  //   // 1. No due day
  //   if (due.has('NONE')) {
  //     OR.push({ dueAtUtc: null });
  //   }

  //   // 2. Due today (include specified and all day tasks)
  //   if (due.has('TODAY')) {
  //     OR.push(
  //       { dueAtUtc: { gte: startUtc, lte: endUtc } },
  //       { allDayLocalDate: todayDateOnlyUtc },
  //     );
  //   }

  //   // 3. Expired
  //   if (due.has('EXPIRED')) {
  //     OR.push(
  //       { dueAtUtc: { lt: startUtc } }, // Time lesser than today means expired
  //       { allDayLocalDate: { lt: todayDateOnlyUtc } },
  //     );
  //   }

  //   // 4. Range
  //   if (due.has('RANGE') && filters.range) {
  //     OR.push({
  //       dueAtUtc: { gte: filters.range.startUtc, lte: filters.range.endUtc },
  //     });
  //   }

  //   const where: Prisma.TaskWhereInput = {
  //     ...(scope.kind === 'owner'
  //       ? { ownerId: scope.ownerId, groupId: null }
  //       : { groupId: scope.groupId }),
  //     status: { in: status },
  //     ...(OR.length ? { OR } : {}),
  //   };

  //   const items = await this.prismaService.task.findMany({
  //     where,
  //     orderBy: this.resolveOrderBy(orderByKey),
  //     take,
  //     include: {
  //       assignees: {
  //         include: {
  //           assignee: { select: { id: true, name: true, email: true } },
  //         },
  //       },
  //       _count: {
  //         select: {
  //           subTasks: { where: { status: { not: 'CLOSED' } } },
  //         },
  //       },
  //     },
  //   });

  //   const mapped = items.map(({ _count, assignees, ...task }) => {
  //     const hasOpenSubTasks = (_count?.subTasks ?? 0) > 0;

  //     return {
  //       ...task,
  //       assignees: assignees.map((a) => ({
  //         id: a.assignee.id,
  //         name: a.assignee.name,
  //         email: a.assignee.email,
  //         status: a.status,
  //       })),
  //       canClose: !hasOpenSubTasks,
  //     };
  //   });

  //   return {
  //     items: mapped,
  //     bounds: { timeZone, startUtc, endUtc, todayDateOnlyUtc },
  //   };
  // }

  private async listTaskCore(
    scope: ListTasksScope,
    timeZone: string,
    filters: ListTasksFilters,
    orderByKey: OrderKey,
    take?: number,
  ): Promise<ListTasksResult> {
    /**
     * Core logic for listing and filtering tasks.
     * Enhanced with "Smooth Close" logic to support seamless UI transitions.
     */
    const status = filters.status ?? ['OPEN'];
    const { startUtc, endUtc, todayDateOnlyUtc } = this.getTaskBounds(timeZone);
    const due = new Set(filters.due ?? []);
    const OR: Prisma.TaskWhereInput[] = [];

    // 1. Boundary Calculations (Same as before)
    if (due.has('NONE')) OR.push({ dueAtUtc: null });
    if (due.has('TODAY')) {
      OR.push(
        { dueAtUtc: { gte: startUtc, lte: endUtc } },
        { allDayLocalDate: todayDateOnlyUtc },
      );
    }
    if (due.has('EXPIRED')) {
      OR.push(
        { dueAtUtc: { lt: startUtc } },
        { allDayLocalDate: { lt: todayDateOnlyUtc } },
      );
    }
    if (due.has('RANGE') && filters.range) {
      OR.push({
        dueAtUtc: { gte: filters.range.startUtc, lte: filters.range.endUtc },
      });
    }

    const where: Prisma.TaskWhereInput = {
      ...(scope.kind === 'owner'
        ? { ownerId: scope.ownerId, groupId: null }
        : { groupId: scope.groupId }),
      status: { in: status },
      ...(OR.length ? { OR } : {}),
    };

    // 2. Database Query with Aggregated Counts
    const items = await this.prismaService.task.findMany({
      where,
      orderBy: this.resolveOrderBy(orderByKey),
      take,
      include: {
        assignees: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
        _count: {
          select: {
            // 🚀 統計未完成的子任務
            subTasks: { where: { status: { not: 'CLOSED' } } },
            // 🚀 統計進行中或待定的指派 (用於判斷是否能絲滑關閉)
            assignees: {
              where: {
                status: { in: ['PENDING', 'ACCEPTED'] },
              },
            },
          },
        },
      },
    });

    // 3. Transformation and Business Logic Mapping
    const mapped = items.map(({ _count, assignees, ...task }) => {
      const openSubTasksCount = _count?.subTasks ?? 0;
      const incompleteAssigneesCount = _count?.assignees ?? 0;

      /**
       * 🟢 isSmoothClose (方案 C 核心)
       * 代表此任務沒有任何遺留事項，管理員可以在首頁直接點擊 Done 而不需要填寫理由。
       */
      const isSmoothClose =
        openSubTasksCount === 0 && incompleteAssigneesCount === 0;

      /**
       * 🟡 canClose
       * 根據你的業務邏輯，如果沒有未完成子任務，通常就具備關閉資格（但可能需要理由）。
       */
      const canClose = openSubTasksCount === 0;

      return {
        ...task,
        assignees: assignees.map((a) => ({
          id: a.assignee.id,
          name: a.assignee.name,
          email: a.assignee.email,
          status: a.status,
        })),
        isSmoothClose,
        canClose,
        pendingCounts: openSubTasksCount + incompleteAssigneesCount,
      };
    });

    return {
      items: mapped,
      bounds: { timeZone, startUtc, endUtc, todayDateOnlyUtc },
    };
  }

  // ----------------- SubTask -----------------

  async createSubTask(payload: SubTaskAddPayload): Promise<void> {
    // 1. 取得父任務資訊，並一併取得 Actor (操作者) 的時區
    // 這裡我們多抓 actor 的時區，因為時間轉換應以操作者為準
    const [parentTask, actorUser] = await Promise.all([
      this.prismaService.task.findUnique({
        where: { id: payload.parentTaskId },
        select: {
          id: true,
          ownerId: true,
          groupId: true,
        },
      }),
      this.prismaService.user.findUnique({
        where: { id: payload.actorId },
        select: { timeZone: true },
      }),
    ]);

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(
        payload.actorId,
        payload.parentTaskId,
      );
    }

    const actorTz = actorUser?.timeZone || 'UTC';

    // 2. 權限檢查
    if (!parentTask.groupId) {
      // 個人任務：只有擁有者可以加子任務
      if (parentTask.ownerId !== payload.actorId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          payload.actorId,
          payload.parentTaskId,
          'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
        );
      }
    } else {
      // 團隊任務：檢查成員資格
      const member = await this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: parentTask.groupId,
            userId: payload.actorId,
          },
        },
      });
      if (!member) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          payload.actorId,
          payload.parentTaskId,
          'CREATE_SUBTASK_ON_GROUP_TASK_NOT_MEMBER',
        );
      }
    }

    // 3. 核心日期處理邏輯 (解決沒選時間變無期限的 Bug)
    let dueAtUtc: Date | null = null;
    let allDayLocalDate: Date | null = null;

    if (payload.allDay) {
      // 全天任務
      allDayLocalDate = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
    } else if (payload.dueDate) {
      // 非全天任務：只要有日期，沒時間就預設 00:00 (或 23:59，依需求)
      const timePart = payload.dueTime || '00:00';
      const localISO = `${payload.dueDate}T${timePart}:00`;
      dueAtUtc = fromZonedTime(localISO, actorTz);
    }

    // 4. 構建 Prisma 資料 (利用物件展開簡化 if)
    const data: Prisma.SubTaskCreateInput = {
      title: payload.title,
      description: payload.description,
      location: payload.location,
      status: payload.status || 'OPEN',
      priority: payload.priority ? Number(payload.priority) : 3,
      allDay: !!payload.allDay,
      dueAtUtc,
      allDayLocalDate,
      // 關聯設定
      task: { connect: { id: parentTask.id } },
    };

    // 建立子任務
    await this.prismaService.subTask.create({ data });

    // 5. 發送通知
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

      // const ADMINISH = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
      // isAdminish = ADMINISH.has(member.role);
      isAdminish = this.isAdminish(member.role);
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

  private isAdminish(role: GroupRole) {
    const IS_ADMIN = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
    return IS_ADMIN.has(role);
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
        AssignmentStatus.SKIPPED,
      ],
      [AssignmentStatus.ACCEPTED]: [
        AssignmentStatus.COMPLETED,
        AssignmentStatus.DECLINED,
        AssignmentStatus.PENDING,
        AssignmentStatus.DROPPED,
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

  private getTaskBounds = (timeZone: string) => {
    const now = new Date();

    // 取得該時區當天的 00:00:00 到 23:59:59 的 UTC 時間
    const { startUtc, endUtc } = dayBoundsUtc(timeZone);

    // 取得該時區當天的 Date-only 物件 (例如 2024-05-20T00:00:00.000Z)
    // 用於 match Prisma 中的 allDayLocalDate 欄位
    const todayStr = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
    const todayDateOnlyUtc = new Date(`${todayStr}T00:00:00.000Z`);

    return {
      startUtc, // 今日開始 (UTC)
      endUtc, // 今日結束 (UTC)
      todayDateOnlyUtc, // 今日日期 (Date-only)
      timeZone,
    };
  };

  private resolveOrderBy(
    orderByKey: OrderKey,
  ): Prisma.TaskOrderByWithRelationInput[] {
    switch (orderByKey) {
      case 'dueAtAscNullsLast':
        return [
          { dueAtUtc: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ];

      case 'expiredPriority':
        return [
          { allDay: 'desc' }, // 全天任務優先
          { allDayLocalDate: 'asc' }, // 日期越早（越過期）越前面
          { dueAtUtc: 'asc' }, // 有時間點的任務按時間排列
        ];

      case 'createdAsc': // 假設這是你的預設或其他選項
      default:
        return [{ createdAt: 'asc' }];
    }
  }
}
