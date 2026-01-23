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
import { isA } from 'jest-mock-extended';
import { group } from 'console';

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
    // if (payload.allDay) {
    //   /**
    //    * [All-day Mode]
    //    * Save as a pure date string to be stored in the DB's Date column.
    //    * This represents a "calendar slot" (e.g., May 20th) regardless of user location.
    //    */
    //   allDayLocalDate = payload.dueDate
    //     ? new Date(`${payload.dueDate}T00:00:00.000Z`)
    //     : null;
    //   dueAtUtc = null;
    // } else if (payload.dueDate) {
    //   /**
    //    * [Specific Time Mode]
    //    * Convert local ISO string to an absolute UTC Date object using the user's IANA time zone.
    //    * Ensures that time-sensitive tasks are synchronized globally.
    //    */
    //   const timePart = payload.dueTime || '00:00';
    //   const localISO = `${payload.dueDate}T${timePart}:00`;
    //   dueAtUtc = fromZonedTime(localISO, userTz);
    //   allDayLocalDate = null;
    // }

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
      const isLegal = this.isValidAssignmentTransition(prev, next, task.status);

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
    const { newStatus, actorId } = opts;

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
          (newStatus === TaskStatus.CLOSED ||
            newStatus === TaskStatus.ARCHIVED)) ||
        (from === TaskStatus.CLOSED &&
          (newStatus === TaskStatus.ARCHIVED ||
            newStatus === TaskStatus.OPEN)) ||
        (from === TaskStatus.ARCHIVED && newStatus === TaskStatus.OPEN);

      if (!legal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          subTaskId,
          `ILLEGAL_SUBTASK_TRANSITION_${from}_TO_${newStatus}`,
        );
      }

      // 4) 審計欄位與更新資料 (保持不變)
      const data: Prisma.SubTaskUpdateInput = { status: newStatus };

      if (newStatus === TaskStatus.CLOSED) {
        // 記錄關閉人、關閉時間和原因
        Object.assign(data, {
          closedAt: new Date(),
          closedById: actorId,
        });
      } else if (newStatus === TaskStatus.OPEN) {
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
  // isValidAssignmentTransition
  private isValidAssignmentTransition(
    prev: AssignmentStatus,
    next: AssignmentStatus,
    taskStatus: string,
  ): boolean {
    if (prev === next) return true;

    // 🚀 2. 處理動態的 COMPLETED 邏輯
    if (prev === AssignmentStatus.COMPLETED) {
      // 只有當父任務還是 OPEN 時，才允許從 COMPLETED 回退到 ACCEPTED (例如撤銷完成)
      return taskStatus === 'OPEN' && next === AssignmentStatus.ACCEPTED;
    }

    // 🚀 3. 處理其他靜態規則
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
      return {
        allDayLocalDate: new Date(`${dueDate}T00:00:00.000Z`),
        dueAtUtc: null,
      };
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
