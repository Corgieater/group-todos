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
import type { Task } from 'src/generated/prisma/client';
import { TaskStatus } from './types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/mail/mail.service';
import { SecurityService } from 'src/security/security.service';
import { TasksGateWay } from './tasks.gateway';
import { PageDto } from 'src/common/dto/page.dto';
import { PageMetaDto } from 'src/common/dto/page-meta.dto';
import { CurrentUser } from 'src/common/types/current-user';
import { UserAccessInfo } from 'src/auth/types/auth';

/**
 * TODO:
 * 1. This service file is too big, we should separate Task and Subtask to another service.
 * 2. Pay attention on repeatedly logics when refactor
 */

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
  private static readonly TASK_STATUS_MAP: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.OPEN]: [TaskStatus.CLOSED, TaskStatus.ARCHIVED],
    [TaskStatus.CLOSED]: [TaskStatus.OPEN, TaskStatus.ARCHIVED],
    [TaskStatus.ARCHIVED]: [TaskStatus.OPEN],
  };

  private static readonly ASSIGNMENT_RULES: Record<
    AssignmentStatus,
    AssignmentStatus[]
  > = {
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
    [AssignmentStatus.SKIPPED]: [],
    [AssignmentStatus.DROPPED]: [],
    [AssignmentStatus.COMPLETED]: [],
  };

  async createTask(
    payload: TasksAddPayload,
    groupId: number | null = null,
  ): Promise<void> {
    /**
     * Creates a new task (parent task) which can contain multiple sub-tasks.
     *
     * @description
     * 1. Validates the existence of the user and retrieves their preferred time zone.
     * 2. Handles temporal logic:
     * - All-day tasks: Stored as a local calendar date (allDayLocalDate), ignoring time zone shifts.
     * - Specific time tasks: Converted from the user's local time to a UTC timestamp (dueAtUtc).
     *
     * @param payload - The data transfer object containing task details (title, status, priority, etc.).
     * @param groupId - Optional. The ID of the group this task belongs to. Defaults to null for personal tasks.
     * @returns A Promise that resolves when the task is successfully created.
     */

    // 1. Fetch user data and handle time zone fallback
    const user = await this.usersService.findByIdOrThrow(payload.userId);
    const userTz = user.timeZone;

    // 2. Process temporal logic based on task type
    const { dueAtUtc, allDayLocalDate } = this.calculateTaskDates(
      payload.allDay,
      payload.dueDate,
      payload.dueTime,
      userTz,
    );

    // 3. Assemble and persist the task entity
    const data: Prisma.TaskCreateInput = {
      title: payload.title,
      description: payload.description,
      location: payload.location,
      status: payload.status || 'OPEN',
      priority: payload.priority ? Number(payload.priority) : 3,
      allDay: !!payload.allDay,
      dueAtUtc,
      allDayLocalDate,
      // Only connect to group if groupId is provided
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
    const pageOptionsDto = { page, limit, skip }; // Mimic PageOptionsDto structure
    const meta = new PageMetaDto(pageOptionsDto as any, itemCount);

    return new PageDto(tasks, meta);
  }

  async getTaskForViewer(
    id: number,
    actorId: number,
  ): Promise<{
    task: TaskWithAllDetails;
    isAdminish: boolean;
    isRealAdmin: boolean;
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

    let isGroupAdmin = false;
    let isTaskOwner = task.ownerId === actorId;

    if (!base.groupId) {
      // 個人任務：Owner 就是 Admin
      isGroupAdmin = true;
    } else {
      const member = await this.prismaService.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId!, userId: actorId } },
        select: { role: true },
      });

      // 真正的群組管理員身分
      isGroupAdmin = member ? this.isAdminish(member.role) : false;
    }

    return {
      task: task as TaskWithAllDetails,
      // 🚀 isAdminish 用來判斷「能不能 Edit/Add SubTask」(Owner 或 Admin 皆可)
      isAdminish: isGroupAdmin || isTaskOwner,
      // 🚀 新增 isRealAdmin 用來判斷「能不能 Force Close/Assign」(僅限 Admin)
      isRealAdmin: isGroupAdmin,
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

  // task指派狀態更新, slef-assign, claim
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
     *
     * *@todo
     * I should separate slef-claim and task status report to 2 methods
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
      const isLegal = this.isValidAssignmentTransition(prev, next, task.status);

      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // 4. update
      const updateData = this.getAssigneeUpdateData(next, reason);

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
     * Closes a task and manages the transition of all related entities (sub-tasks and assignees).
     * * This method implements a "Restricted Management" policy:
     * 1. If the task is fully completed (no open sub-tasks/assignees), the Owner or an Admin can close it.
     * 2. If the task has incomplete items, ONLY an Admin can "Force Close" it by providing a reason.
     * * @param id - The unique identifier of the task to close.
     * @param actorId - The ID of the user performing the action.
     * @param opts - Optional parameters, specifically the closure reason for force-closing.
     * @returns {Promise<Task>} The updated task record.
     * * @throws {TasksErrors.TaskNotFoundError} If the task does not exist or the user lacks access.
     * @throws {TasksErrors.TaskForbiddenError}
     * - Action: 'FORCE_CLOSE_REASON_REQUIRED' if items are open but no reason is provided.
     * - Action: 'CLOSE_TASK' if a non-admin tries to force close or unauthorized access.
     */

    // 1. Fetch task and statistics regarding sub-tasks and assignments
    const task = await this.prismaService.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        ownerId: true,
        groupId: true,
        _count: {
          select: {
            subTasks: { where: { status: { not: TaskStatus.CLOSED } } },
            assignees: {
              where: {
                status: {
                  in: [
                    AssignmentStatus.PENDING,
                    AssignmentStatus.ACCEPTED,
                    AssignmentStatus.DECLINED,
                  ],
                },
              },
            },
          },
        },
      },
    });

    if (!task) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    // Return immediately if task is already closed to ensure idempotency
    if (task.status === TaskStatus.CLOSED) return task as any;

    // 2. Identify roles and permissions
    let isGroupAdmin = false;
    const isTaskOwner = task.ownerId === actorId;

    if (task.groupId) {
      const member = await this.prismaService.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId, userId: actorId } },
        select: { role: true },
      });

      // Ensure user is part of the group
      if (!member) throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      isGroupAdmin = this.isAdminish(member.role);
    } else {
      // Personal tasks: Only the owner can manage, acting as an implicit Admin
      if (!isTaskOwner) throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      isGroupAdmin = true;
    }

    // 3. Implement Level 2: Restricted Management Logic
    const hasOpenItems = task._count.subTasks > 0 || task._count.assignees > 0;

    // A. Request a reason if items are incomplete to trigger the frontend "Force Close" modal
    if (hasOpenItems && !opts?.reason) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        'FORCE_CLOSE_REASON_REQUIRED',
      );
    }

    // B. Permission validation:
    // - Force Close (items remain): Restricted to Admins.
    // - Normal Close (all items done): Allowed for both Owner and Admin.
    const isAttemptingForceClose = hasOpenItems && opts?.reason;
    const canPerformAction = isGroupAdmin || (isTaskOwner && !hasOpenItems);

    if (!canPerformAction) {
      const cause = isAttemptingForceClose
        ? 'Only administrators can force close tasks with incomplete items.'
        : 'User do not have permission to close this task.';

      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        'CLOSE_TASK',
        { cause },
      );
    }

    // 4. Execute Transaction to update task and related assignments/sub-tasks
    return this.prismaService.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          closedById: actorId,
          closedReason: opts?.reason ?? null,
          closedWithOpenAssignees: hasOpenItems,
        },
      });

      // Update assignment statuses for audit and clean-up
      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.DROPPED, updatedAt: new Date() },
      });

      await tx.taskAssignee.updateMany({
        where: { taskId: id, status: AssignmentStatus.PENDING },
        data: { status: AssignmentStatus.SKIPPED, updatedAt: new Date() },
      });

      // If force-closed, terminate all remaining open sub-tasks
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
          newStatus: TaskStatus.ARCHIVED,
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
     * Restores a task to 'OPEN' status from either 'CLOSED' or 'ARCHIVED'.
     * * @description
     * This is a high-level orchestration method that performs the following:
     * 1. **State Transition & Validation**: Delegates core logic to `executeUpdateLogic`,
     * ensuring the transition is legal (via State Machine) and the user has sufficient permissions.
     * 2. **Audit Reset**: Automatically clears completion-related fields (e.g., `closedAt`, `closedReason`).
     * 3. **Conditional Cascading**:
     * - If restored from `ARCHIVED`: Reactivates all associated sub-tasks that were previously archived.
     * - If restored from `CLOSED`: Reverts assignees marked as `SKIPPED` or `DROPPED` back to `PENDING`.
     * * @param id - The unique identifier of the task to be restored.
     * @param actorId - The ID of the user performing the restoration.
     * @throws {TasksErrors.TaskNotFoundError} If the task does not exist.
     * @throws {TasksErrors.TaskForbiddenError} If the user lacks permission or the transition is illegal.
     * @returns {Promise<void>} Resolves when the transaction is successfully committed.
     */

    // 1. Fetch the task's current status BEFORE updating
    // We need to know where it's coming from to apply specific side effects
    const task = await this.prismaService.task.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    const originalStatus = task.status;

    // 2. Use a transaction to ensure atomic updates
    return this.prismaService.$transaction(async (tx) => {
      // 🚀 [KEY MOVE] Call the unified logic
      // This handles: Permissions, State Machine, and Task audit field resets (closedAt, etc.)
      await this.executeUpdateLogic(
        id,
        { newStatus: TaskStatus.OPEN, actorId },
        tx,
      );

      // 3. Apply side effects based on the original status
      if (originalStatus === TaskStatus.ARCHIVED) {
        await this.handleRestoreFromArchived(id, tx);
      }

      if (originalStatus === TaskStatus.CLOSED) {
        await this.handleRestoreFromClosed(id, tx);
      }
    });
  }

  private async handleRestoreFromArchived(
    taskId: number,
    tx: Prisma.TransactionClient,
  ) {
    /**
     * Handles the cascading restoration of sub-tasks when a parent task is unarchived.
     * * @description
     * This method ensures data consistency by automatically moving all associated sub-tasks
     * back to 'OPEN' status, but ONLY if they were in the 'ARCHIVED' state.
     * Sub-tasks that were manually 'CLOSED' before the parent task was archived will remain
     * 'CLOSED' to preserve the user's original progress.
     * * @param taskId - The unique identifier of the parent task being restored.
     * @param tx - The active Prisma transaction client to ensure atomicity.
     * @returns {Promise<void>}
     * @private
     */

    // Restore subtasks that were automatically archived
    await tx.subTask.updateMany({
      where: { taskId, status: TaskStatus.ARCHIVED },
      data: { status: TaskStatus.OPEN },
    });
  }

  private async handleRestoreFromClosed(
    taskId: number,
    tx: Prisma.TransactionClient,
  ) {
    /**
     * Manages the cascading side effects for task assignees when a task is reopened from 'CLOSED'.
     *
     * @description
     * This method ensures that team collaboration can resume effectively by:
     * 1. Identifying assignees who were sidelined during the task's closure (marked as 'SKIPPED' or 'DROPPED').
     * 2. Reverting their status back to 'PENDING', effectively putting the task back on their to-do list.
     * * It specifically avoids touching users who already reached 'COMPLETED' or 'DECLINED' to
     * respect their finalized contribution or explicit refusal.
     *
     * @param taskId - The unique identifier of the task being reopened.
     * @param tx - The active Prisma transaction client to ensure database atomicity.
     * @returns {Promise<void>}
     * @private
     */

    // Bring back assignees who were marked as SKIPPED/DROPPED due to task closure
    await tx.taskAssignee.updateMany({
      where: {
        taskId,
        status: { in: [AssignmentStatus.SKIPPED, AssignmentStatus.DROPPED] },
      },
      data: { status: AssignmentStatus.PENDING },
    });
  }

  async updateTaskStatus(
    id: number,
    opts: UpdateStatusOpts,
    txHost?: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO:
    // Logic about close task should be removed since we have closeTask
    /**
     * Updates the status of a task with built-in transaction management.
     * * @description
     * This method serves as the public entry point for status transitions. It implements
     * a "Transaction Propagation" pattern:
     * 1. **Reusability**: If an existing transaction (`txHost`) is provided, it joins
     * that transaction to ensure atomic operations across multiple service calls.
     * 2. **Auto-encapsulation**: If no transaction is provided, it initiates a new
     * Prisma transaction to wrap the update logic.
     * * This ensures that if any part of the status update (including side effects like
     * audit logging or cascading) fails, the entire operation is rolled back, preventing
     * data inconsistency.
     * * @param id - The unique identifier of the task.
     * @param opts - Configuration for the update (target status, actor, reason, etc.).
     * @param txHost - (Optional) An existing Prisma transaction client to participate in.
     * @returns {Promise<void>}
     */

    // If txHost provided, use it directly
    if (txHost) {
      return this.executeUpdateLogic(id, opts, txHost);
    }

    // If not, open a new transaction
    return this.prismaService.$transaction(async (tx) => {
      return this.executeUpdateLogic(id, opts, tx);
    });
  }

  private async executeUpdateLogic(
    id: number,
    opts: UpdateStatusOpts,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    /**
     * Core internal logic for updating task status.
     * Designed to be executed within a Prisma Transaction.
     * * @param id - Task ID
     * @param opts - Update options (target status, actor, force flag, reason)
     * @param tx - The active Prisma Transaction Client
     */
    const { newStatus, actorId, force, reason } = opts;
    const isClosingTask = newStatus === TaskStatus.CLOSED;

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
        assignees: isClosingTask ? { select: { status: true } } : false,
        subTasks: isClosingTask ? { select: { status: true } } : false,
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
    const isLegalTransition = this.taskStatusCanTransition(from, newStatus);

    if (!isLegalTransition) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        actorId,
        id,
        `ILLEGAL_TRANSITION_${from}_TO_${newStatus}`,
      );
    }

    // -----------------------------------------------------------
    // 4) Completion Rules (SubTask & Assignee Validation)
    // -----------------------------------------------------------
    let closedWithOpenAssignees = false;
    let closedReason: string | null = null;

    if (isClosingTask) {
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
    const updateData: Prisma.TaskUpdateInput = { status: newStatus };

    if (newStatus === TaskStatus.CLOSED) {
      Object.assign(updateData, {
        closedAt: new Date(),
        closedById: actorId,
        closedReason,
        closedWithOpenAssignees,
      });
    } else if (newStatus === TaskStatus.OPEN) {
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
            // Check for blockers: Sub-tasks that are not yet finalized
            subTasks: { where: { status: { not: 'CLOSED' } } },
            // Check for engagement: Active assignees who haven't finished their part
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
       * isSmoothClose:
       * Indicates the task can be closed immediately without a confirmation modal.
       * Condition: No unfinished sub-tasks AND all assignees have completed their work.
       */
      const isSmoothClose =
        openSubTasksCount === 0 && incompleteAssigneesCount === 0;

      /**
       * canClose:
       * Determines if the 'Close' button is enabled at all.
       * Condition: All sub-tasks must be 'CLOSED' first.
       * Note: If incompleteAssigneesCount > 0, the UI should prompt for a
       * 'Force Close' reason.
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
        // Combined count of items requiring attention before a "normal" close
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
    /**
     * Creates a new sub-task under a specified parent task.
     * * @description
     * This method performs the following workflow:
     * 1. **Data Retrieval**: Fetches parent task metadata and the actor's time zone settings in parallel.
     * 2. **Authorization**:
     * - For personal tasks: Ensures only the task owner can add sub-tasks.
     * - For group tasks: Validates that the actor is a registered member of the group.
     * 3. **Temporal Processing**: Delegates local-to-UTC time conversion and all-day date handling
     * to the specialized `calculateTaskDates` helper.
     * 4. **Persistence**: Creates the sub-task record in the database using Prisma.
     * 5. **Event Emission**: Triggers a real-time notification to inform relevant parties of the new sub-task.
     * * @param payload - The data transfer object (DTO) containing sub-task details and actor information.
     * @throws {TasksErrors.TaskNotFoundError} If the parent task does not exist.
     * @throws {UsersErrors.UserNotFoundError} If the actor (user) cannot be found.
     * @throws {TasksErrors.TaskForbiddenError} If the user lacks the necessary permissions.
     * @returns {Promise<void>} Resolves when the sub-task is successfully created and notified.
     */

    // 1. Get parent task info and acotr time zone for time transition
    const [parentTask, actor] = await Promise.all([
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
        select: { id: true, timeZone: true },
      }),
    ]);

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(
        payload.actorId,
        payload.parentTaskId,
      );
    }

    if (!actor) {
      throw UsersErrors.UserNotFoundError.byId(payload.actorId);
    }

    const actorTz = actor.timeZone;

    // 2. Permission check
    if (!parentTask.groupId) {
      // Personaly task only allowed owner add subTasks
      if (parentTask.ownerId !== actor.id) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          payload.actorId,
          payload.parentTaskId,
          'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
        );
      }
    } else {
      // Group task: check member role
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

    // 3. Core daytime logic (deal with infinite)
    const { dueAtUtc, allDayLocalDate } = this.calculateTaskDates(
      payload.allDay,
      payload.dueDate,
      payload.dueTime,
      actorTz,
    );

    // 4. Build prisma obj
    const data: Prisma.SubTaskCreateInput = {
      title: payload.title,
      description: payload.description,
      location: payload.location,
      status: payload.status || 'OPEN',
      priority: payload.priority ? Number(payload.priority) : 3,
      allDay: !!payload.allDay,
      dueAtUtc,
      allDayLocalDate,
      task: { connect: { id: parentTask.id } },
    };

    // Create subTask
    await this.prismaService.subTask.create({ data });

    // 5. Send notification
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
    /**
     * Retrieves comprehensive sub-task details tailored for the current viewer.
     * * @description
     * This method acts as the data provider for the sub-task detail page, performing:
     * 1. **Authorization**: Validates if the `actorId` has permission to view the parent task.
     * - For Personal Tasks: Access is restricted to the owner.
     * - For Group Tasks: Access is restricted to group members.
     * 2. **Role Determination**: Calculates `isAdminish` status to control administrative UI
     * elements (e.g., editing, force-closing).
     * 3. **Data Fetching**: Retrieves the sub-task with its assignees, audit info (who closed it),
     * and parent task context.
     * 4. **Contextual Enrichment**: For group tasks, it aggregates a list of potential assignees
     * (group members) for the "Assign Member" dropdown.
     * * @param parentId - The ID of the parent task.
     * @param id - The ID of the sub-task to be retrieved.
     * @param actorId - The ID of the user requesting the data.
     * * @throws {TasksErrors.TaskNotFoundError} If the parent task or sub-task does not exist.
     * @throws {TasksErrors.TaskForbiddenError} If the user is not authorized to view the task.
     * * @returns {Promise<{
     * subTask: SubTaskWithAssignees;
     * isAdminish: boolean;
     * groupMembers: GroupMemberInfo[];
     * }>} A structured object containing task data and UI control flags.
     */

    // 1. Get parent task info
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: parentId },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, parentId);
    }

    // 2. Permission check and determine if Adminish
    let isAdminish = false;

    if (!parentTask.groupId) {
      // Personal task: only reveal info to owner, owner is adminish
      if (parentTask.ownerId !== actorId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          id,
          'NOT_OWNER',
        );
      }
      isAdminish = true;
    } else {
      // Group task: check if a member and role
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

      isAdminish = this.isAdminish(member.role);
    }

    // 3. Core search：get subTask details
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

    // 4. Get member list for drop list
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
    actorTz: string,
    payload: TaskUpdatePayload,
  ): Promise<void> {
    /**
     * Updates a sub-task's details with integrated permission and temporal logic.
     *
     * @description
     * This method implements a secure update workflow:
     * 1. **Data Consolidation**: Uses a single nested query to retrieve the sub-task, its parent task,
     * and the actor's group membership status to minimize database round-trips.
     * 2. **Authorization**:
     * - Personal Tasks: Strict ownership check (Actor must be the parent task owner).
     * - Group Tasks: Membership check (Any group member can update sub-tasks to foster collaboration).
     * 3. **Temporal Normalization**: Leverages `getCommonUpdateData` to handle time zone-to-UTC
     * conversions for due dates.
     * 4. **Event Propagation**: Dispatches a WebSocket notification via `notifyTaskChange` to
     * synchronize UI states for all users in the same task room.
     *
     * @param id - The unique identifier of the sub-task.
     * @param actorId - The user performing the update.
     * @param actorTz - The IANA time zone string of the actor.
     * @param payload - The update DTO containing partial fields (title, priority, etc.).
     *
     * @throws {TasksErrors.TaskNotFoundError} If the sub-task doesn't exist or permissions are denied.
     * @returns {Promise<void>} Resolves when the update and notification are complete.
     */

    // 1. Get subTask, parent task and role of the actor
    const subTask = await this.prismaService.subTask.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            ownerId: true,
            groupId: true,
            group: {
              select: {
                members: {
                  where: { userId: actorId },
                  select: { role: true },
                },
              },
            },
          },
        },
      },
    });

    // 2. Basic checking
    if (!subTask) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    const parentTask = subTask.task;
    const groupMember = parentTask.group?.members[0];

    // 3. Permission checking
    // Personal task: must be owner
    if (!parentTask.groupId && parentTask.ownerId !== actorId) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // Group task: must be member
    if (parentTask.groupId && !groupMember) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    // 4. Build data and time
    const data = this.getCommonUpdateData<Prisma.SubTaskUpdateInput>(
      payload,
      actorTz,
    );

    // 5. Update
    await this.prismaService.subTask.update({
      where: { id },
      data,
    });

    // 6. Notification
    this.notifyTaskChange(
      subTask.taskId,
      actorId,
      'Someone',
      'SUBTASK_UPDATED',
    );
  }

  async closeSubTask(id: number, actorId: number) {
    // TODO:
    // 1. Consider if it's a must to split the checking subTask logic
    // since it's pretty much the same like updateSubTask
    // 2. Here is no 'force close' like close the parent Task in the frontend and here
    const subTask = await this.prismaService.subTask.findUnique({
      where: {
        id,
      },
      include: {
        task: {
          select: {
            id: true,
            ownerId: true,
            groupId: true,
            group: {
              select: {
                members: { where: { userId: actorId }, select: { role: true } },
              },
            },
          },
        },
      },
    });

    if (!subTask) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    const parentTask = subTask.task;
    const groupMember = parentTask.group?.members[0];

    if (!parentTask.groupId && parentTask.ownerId !== actorId) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

    if (parentTask.groupId && !groupMember) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, id);
    }

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
    // TODO:
    // 1. Should check authentication, there is another reason to pull out
    // the checking authentication as decorater and separate the service.
    // 2.Logic about close task should be removed since we have closeSubTask
    /**
     * Updates the status of a sub-task with state transition validation.
     * * @param subTaskId - The unique identifier of the sub-task.
     * @param opts - Configuration object containing the new status and actor's ID.
     * * @description
     * This method manages simple state transitions for sub-tasks. It ensures that
     * the requested status change adheres to the defined Task State Machine rules.
     * * @throws {TasksErrors.TaskNotFoundError}
     * Thrown if the sub-task does not exist or the actor is unauthorized.
     * * @throws {TasksErrors.TaskForbiddenError}
     * Thrown if the status transition is logically invalid (e.g., CLOSED to IN_PROGRESS).
     * * @todo
     * 1. Extract Authorization: Pull out the authentication logic into a dedicated
     * Access Control Service or Decorator to align with the Single Responsibility Principle (SRP).
     * 2. Logic Consolidation: Delegate terminal state logic (CLOSED) to `closeSubTask`
     * to avoid logic duplication and ensure consistent side-effect management.
     */
    const { newStatus, actorId } = opts;

    return this.prismaService.$transaction(async (tx) => {
      // 1. Get subTask
      const subTask = await tx.subTask.findUnique({
        where: { id: subTaskId },
        select: {
          id: true,
          status: true,
        },
      });

      if (!subTask)
        throw TasksErrors.TaskNotFoundError.byId(actorId, subTaskId);

      // 2. Check if it is a legal status transition
      const from = subTask.status;
      const legal = this.taskStatusCanTransition(from, newStatus);

      if (!legal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          `ILLEGAL_SUBTASK_TRANSITION_${from}_TO_${newStatus}`,
        );
      }

      // 4) Build update data
      const data: Prisma.SubTaskUpdateInput = { status: newStatus };

      if (newStatus === TaskStatus.CLOSED) {
        Object.assign(data, {
          closedAt: new Date(),
          closedById: actorId,
        });
      } else if (newStatus === TaskStatus.OPEN) {
        Object.assign(data, {
          closedAt: null,
          closedById: null,
        });
      }

      // 5) update
      await tx.subTask.update({ where: { id: subTaskId }, data });
    });
  }

  async restoreSubTask(id: number) {
    /**
     * A method for restore closed or archived task
     *
     * *@todo
     * Should check authentication
     */
    return this.prismaService.subTask.update({
      where: { id },
      data: {
        status: TaskStatus.OPEN,
        closedAt: null,
        closedById: null,
      },
    });
  }

  // subtask指派狀態更新, self-assign, claim相關
  async updateSubTaskAssigneeStatus(
    subTaskId: number,
    actorId: number,
    dto: { status: AssignmentStatus; reason?: string },
    updatedBy: string | null = null,
  ) {
    /**
     * Manages sub-task assignment lifecycle, supporting both "Auto-Claiming" and status reporting.
     * * @param subTaskId - The unique identifier of the sub-task.
     * @param actorId - The ID of the user performing the status update.
     * @param dto - Data containing the target AssignmentStatus and an optional reason.
     * @param updatedBy - (Optional) The name of the actor for notification purposes.
     * * @description
     * This method acts as the primary interface for users to interact with sub-task assignments:
     * 1. **Auto-Claiming**: If no assignment record exists and the status is set to 'ACCEPTED',
     * the system automatically creates a new assignment for the actor.
     * 2. **State Management**: If a record exists, it validates the transition against the
     * Assignment State Machine before updating.
     * * @constraints
     * - Restricted to **Group Tasks** only; personal sub-tasks do not support assignment tracking.
     * - Only valid **Group Members** can claim or update assignment statuses.
     * * @returns {Promise<{ ok: boolean }>} A confirmation object upon successful transaction.
     * * @throws {TasksErrors.TaskNotFoundError} If the sub-task does not exist.
     * @throws {TasksErrors.TaskForbiddenError}
     * - 'ASSIGNEE_STATUS_FOR_PERSONAL_SUBTASK': Attempting to assign on a personal task.
     * - 'ASSIGNEE_STATUS_FOR_NON_MEMBER': Actor is not a member of the task's group.
     * - 'ASSIGNEE_STATUS_ILLEGAL_TRANSITION': The state transition violates business rules.
     * @todo
     * I think I should separate self-claim and assigned subTask status report to 2 methods
     */
    const { status: next, reason } = dto;

    return this.prismaService.$transaction(async (tx) => {
      // 1. Get subTasks and parent task info
      const subTask = await tx.subTask.findUnique({
        where: { id: subTaskId },
        include: {
          task: { select: { id: true, groupId: true, status: true } },
        },
      });

      if (!subTask)
        throw TasksErrors.TaskNotFoundError.byId(actorId, subTaskId);

      // Safety check: only group task supports assigned-subtask status updating
      if (!subTask.task.groupId) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          'ASSIGNEE_STATUS_FOR_PERSONAL_SUBTASK',
        );
      }

      // Check if actor is really a group member
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

      // 2. Check if there is a subTask assigning record
      const assignee = await tx.subTaskAssignee.findUnique({
        where: { subTaskId_assigneeId: { subTaskId, assigneeId: actorId } },
        select: { status: true },
      });

      // -----------------------------------------------------------
      // 3. Self-claim logic: no subTask assigning record
      // and want to turn the status to ACCEPTED
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
      // 4. Check if status is legal to change
      // -----------------------------------------------------------
      const prev = assignee.status;
      const isLegal = this.isValidAssignmentTransition(
        prev,
        next,
        subTask.status,
      );

      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${prev}_TO_${next}`,
        );
      }

      // -----------------------------------------------------------
      // 5. Update
      // -----------------------------------------------------------
      const updateData = this.getAssigneeUpdateData(next, reason);

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
    /**
     * Internal orchestrator for handling task and sub-task assignments.
     * * @param options - Configuration for the assignment process, including target type and notification flags.
     * * @description
     * This private method centralizes the assignment logic for both high-level Tasks and Sub-tasks:
     * 1. **Resource Discovery**: Resolves group context and metadata based on the target type.
     * 2. **Dual-Factor Authentication**:
     * - Validates that the Assigner has administrative privileges (Admin/Owner).
     * - Ensures the Assignee is a valid member of the associated group.
     * 3. **Smart Persistence**: Performs an `upsert` operation. If the actor assigns a task to
     * themselves, the status is automatically set to 'ACCEPTED'; otherwise, it remains 'PENDING'.
     * 4. **Urgent Notification**: Optionally triggers an email dispatch with deep-linking to the specific task.
     * * @throws {TasksErrors.TaskNotFoundError} If the target resource or group context is missing.
     * @throws {TasksErrors.TaskForbiddenError} If a non-administrative member attempts to assign tasks.
     * * @returns {Promise<TaskAssignee | SubTaskAssignee>} The resulting assignment record.
     * * @todo
     * 1. Currently this method can assign self, this is duplicated with self-claim.
     * But to fix this problem, we need to change a lot of things
     * (frontend and get member list api).
     * I think using create is more logical than upsert. The reason why I use upsert
     * is that once an assigner saw an assignee set task to 'completed',
     * but actually not reaching the criteria. Assigner can use this method to
     * 'send back' the task and makes the assignee to re-do it. But this is actually
     * a bad idea since the assigning history will be washed away.
     * To change this behavior needs to develop other api and more frontned chanings.
     */

    const { type, targetId, assigneeId, assignerId, sendUrgentEmail } = options;

    // 1. Get basic infomation from type(Task or subTask)
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

    // 2. Assigner authentication check
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

    // 3. Assignee authentication check
    const isAssigneeMember = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: assigneeId } },
    });

    if (!isAssigneeMember)
      throw TasksErrors.TaskNotFoundError.byId(assignerId, targetId);

    // 4. Do upsert
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

    // 5. Email notifaication
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
    /**
     * Aggregates and prioritizes pending assignments for a specific user.
     * * @param userId - The ID of the user whose notifications are being retrieved.
     * @returns {Promise<Array>} A sorted array of the top 20 most urgent tasks and sub-tasks.
     * * @description
     * This method performs a unified retrieval of pending work items:
     * 1. **Parallel Fetching**: Uses `Promise.all` to concurrently fetch pending 'Task' and 'SubTask'
     * assignments to minimize latency.
     * 2. **Data Normalization**: Transforms distinct database models into a consistent
     * Notification UI format, ensuring uniform property names for sorting and rendering.
     * 3. **Dual-Tier Sorting**:
     * - **Primary**: Sorted by `priority` (ascending, where 1 is highest).
     * - **Secondary**: Sorted by `dueAt` date. Tasks without a deadline are treated as
     * `Infinity` to ensure they appear after time-sensitive items.
     * 4. **Display Limit**: Returns only the top 20 items to prevent information overload (Cognitive Ease).
     */
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
                  id: true, // for url link
                  group: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const rawTasks = tasks.map((t) => ({
      ...t.task,
      type: 'TASK',
      url: `/tasks/${t.task.id}`,
    }));

    const rawSubTasks = subTasks.map((st) => ({
      ...st.subtask,
      type: 'SUBTASK',
      url: `/tasks/${st.subtask.task.id}`,
    }));

    return [...rawTasks, ...rawSubTasks]
      .sort((a, b) => {
        // 1. Compare priority
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        // 2. If priorities are the same, compare dueAt
        // Handle null dueAt by treating them as Infinity (to be sorted last)
        const timeA = a.dueAtUtc ? new Date(a.dueAtUtc).getTime() : Infinity;
        const timeB = b.dueAtUtc ? new Date(b.dueAtUtc).getTime() : Infinity;

        return timeA - timeB;
      })
      .slice(0, 20);
  }

  async executeAssignmentDecision(
    token: string,
    status: AssignmentStatus,
  ): Promise<{
    taskId: number;
    subTaskId?: number;
    accessPayload: UserAccessInfo;
  }> {
    // Verify token
    const payload = await this.securityService.verifyTaskDecisionToken(token);
    const user = await this.usersService.findById(payload.userId);

    if (!user) {
      throw UsersErrors.UserNotFoundError.byId(payload.userId);
    }

    const accessPayload: UserAccessInfo = {
      sub: user.id,
      userName: user.name,
      email: user.email,
      timeZone: user.timeZone,
    };

    // If it's a subTask assignment
    if (payload.subTaskId) {
      await this.updateSubTaskAssigneeStatus(
        payload.subTaskId,
        payload.userId,
        {
          status,
        },
      );
      return {
        taskId: payload.taskId,
        subTaskId: payload.subTaskId,
        accessPayload,
      };
    }

    // If it's a task assignment
    await this.updateAssigneeStatus(payload.taskId, payload.userId, {
      status,
    });

    return { taskId: payload.taskId, accessPayload };
  }

  //  ----------------- Common helper -----------------

  private getCommonUpdateData<T extends TaskModelFields | SubTaskModelFields>(
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

    // Deal with date and time
    const { dueAtUtc, allDayLocalDate } = this.calculateTaskDates(
      !!payload.allDay,
      payload.dueDate,
      payload.dueTime,
      timeZone,
    );

    if (payload.dueDate !== undefined) {
      data.allDay = !!payload.allDay;
      data.dueAtUtc = dueAtUtc;
      data.allDayLocalDate = allDayLocalDate;
    }

    return data as T;
  }

  private getAssigneeUpdateData(next: AssignmentStatus, reason?: string) {
    /**
     * Generates the structured data object for updating TaskAssignee records.
     * * @param next - The target AssignmentStatus to transition to.
     * @param reason - An optional reason, typically required when the status is 'DECLINED'.
     * * @description
     * This helper method encapsulates the side effects of status transitions:
     * 1. **State-Driven Mapping**: Uses a lookup table to define which timestamps (acceptedAt,
     * completedAt, etc.) should be set or reset based on the new status.
     * 2. **Audit Integrity**: Ensures that the `updatedAt` field is consistently refreshed and
     * irrelevant timestamps are cleared when a task is reset to 'PENDING'.
     * 3. **Data Normalization**: Returns a partial update object compatible with Prisma's update operations.
     * * @returns {Record<string, any>} A data object containing the status and its associated field updates.
     */
    const now = new Date();

    // 1. Define field operations associated with each status
    const statusEffects = {
      [AssignmentStatus.ACCEPTED]: {
        acceptedAt: now,
        declinedAt: null,
        completedAt: null,
      },
      [AssignmentStatus.DECLINED]: {
        declinedAt: now,
        completedAt: null,
        reason: reason ?? null,
      },
      [AssignmentStatus.COMPLETED]: {
        completedAt: now,
      },
      [AssignmentStatus.PENDING]: {
        acceptedAt: null,
        declinedAt: null,
        completedAt: null,
        reason: null,
      },
    };

    // 2. Retrieve state-specific data or fallback to an empty object
    const effect = statusEffects[next] || {};

    return {
      status: next,
      ...effect,
      updatedAt: now, // Ensure the global update timestamp is always refreshed
    };
  }

  private isAdminish(role: GroupRole) {
    const IS_ADMIN = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
    return IS_ADMIN.has(role);
  }

  private isValidAssignmentTransition(
    prev: AssignmentStatus,
    next: AssignmentStatus,
    taskStatus: string,
  ): boolean {
    if (prev === next) return true;

    // Deal with dynamic COMPLETED logic
    if (prev === AssignmentStatus.COMPLETED) {
      // Only when the parent task is still OPEN, allow transition from COMPLETED back to ACCEPTED
      return taskStatus === 'OPEN' && next === AssignmentStatus.ACCEPTED;
    }

    // Deal with other status rules
    const allowed = TasksService.ASSIGNMENT_RULES[prev];
    return allowed?.includes(next) ?? false;
  }

  private taskStatusCanTransition(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true; // Staying in the same status is usually okay
    const allowed = TasksService.TASK_STATUS_MAP[from];
    return allowed ? allowed.includes(to) : false;
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

    // Get the start and end UTC time of today in the specified time zone
    const { startUtc, endUtc } = dayBoundsUtc(timeZone);

    // Get the date-only object for today in that time zone
    // (e.g. 2024-05-20T00:00:00.000Z) for matching the allDayLocalDate field in Prisma
    const todayStr = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
    const todayDateOnlyUtc = new Date(`${todayStr}T00:00:00.000Z`);

    return {
      startUtc, // start of today time (UTC)
      endUtc, // end of today time (UTC)
      todayDateOnlyUtc, // date today (Date-only)
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
          { allDay: 'asc' }, // Non-all-day tasks go first
          { allDayLocalDate: 'asc' }, // The earlier the date, the higher the priority
          { dueAtUtc: 'asc' }, // Arrange by due date for tasks with the same allDay and allDayLocalDate
        ];

      case 'createdAsc': // default
      default:
        return [{ createdAt: 'asc' }];
    }
  }

  /**
   * Processes local date and time input into database-ready UTC and Local Date formats.
   * * @param isAllDay - Whether the task is an all-day event.
   * @param dueDate - The local date string (YYYY-MM-DD).
   * @param dueTime - The local time string (HH:mm), optional.
   * @param userTz - The user's IANA time zone identifier.
   * @returns An object containing the absolute UTC point and the localized calendar date.
   */
  private calculateTaskDates(
    isAllDay: boolean,
    dueDate: string | null | undefined,
    dueTime: string | null | undefined,
    userTz: string = 'UTC',
  ): { dueAtUtc: Date | null; allDayLocalDate: Date | null } {
    // Defensive check: If no date is provided, both are null
    if (!dueDate) {
      return { dueAtUtc: null, allDayLocalDate: null };
    }

    if (isAllDay) {
      const allDayLocalDate = new Date(`${dueDate}T00:00:00.000Z`);
      const localEndOfDay = `${dueDate}T23:59:59.999`;

      const dueAtUtc = fromZonedTime(localEndOfDay, userTz);

      return { allDayLocalDate, dueAtUtc };
    }

    // Non all-day: Specific time logic
    const timePart = dueTime || '00:00';
    const localISO = `${dueDate}T${timePart}:00`;

    return {
      dueAtUtc: fromZonedTime(localISO, userTz),
      allDayLocalDate: null,
    };
  }
}
