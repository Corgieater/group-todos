import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  AssignTaskPayload,
  GroupMemberInfo,
  TasksAddPayload,
  TaskUpdatePayload,
  TaskWithAllDetails,
  UpdateStatusOpts,
  ListTasksResult,
  TaskUpdateContext,
  TaskCloseContext,
  OrderKey,
} from '../types/tasks';
import {
  AssignmentStatus,
  Prisma,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import type { Task } from 'src/generated/prisma/client';
import { TaskStatus } from '../types/enum';
import { TasksErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { PageDto } from 'src/common/dto/page.dto';
import { PageMetaDto } from 'src/common/dto/page-meta.dto';
import { CurrentUser } from 'src/common/types/current-user';
import { TasksUtils } from '../tasks.util';
import { TasksHelperService } from './helper.service';
import { TaskAssignmentManager } from './task-assignment.service';

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

@Injectable()
export class TasksService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly tasksHelper: TasksHelperService,
    private readonly taskAssignmentManager: TaskAssignmentManager,
  ) {}

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
    const { dueAtUtc, allDayLocalDate } = TasksUtils.calculateTaskDates(
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
      isGroupAdmin = member ? TasksUtils.isAdminish(member.role) : false;
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
    ctx: TaskUpdateContext,
    payload: TaskUpdatePayload,
  ): Promise<TaskModel> {
    /**
     * Updates an existing task's attributes based on the provided payload and context.
     * * This method serves as the core logic for task updates, handling:
     * 1. **Permission Enforcement**: Ensures the actor is either the task owner or a group administrator.
     * 2. **Data Transformation**: Converts local dates/times to UTC based on the actor's timezone.
     * 3. **Audit & Notification**: Triggers real-time notifications to relevant parties after a successful update.
     *
     * @param ctx - The execution context containing actor info and pre-calculated permissions:
     * - `id`: The unique identifier of the task to update.
     * - `userId`: The ID of the user performing the action.
     * - `timeZone`: The IANA timezone string of the actor.
     * - `userName`: The display name of the actor for notifications.
     * - `isAdminish`: Boolean indicating if the actor has administrative rights.
     * - `isOwner`: Boolean indicating if the actor created the task.
     * @param payload - Data transfer object containing the fields to be updated.
     * * @returns {Promise<TaskModel>} The updated task record from the database.
     * * @throws {TasksErrors.TaskForbiddenError}
     * Thrown if the actor is neither the owner nor an administrator.
     * @throws {TasksErrors.TaskNotFoundError}
     * Thrown if the task ID is invalid or if a unique constraint (P2002) is violated during update.
     */
    const { id, userId, timeZone, userName, isAdminish, isOwner } = ctx;

    if (!isAdminish && !isOwner) {
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        userId,
        id,
        'UPDATE-TASK',
      );
    }

    const commonData = TasksUtils.getCommonUpdateData<Prisma.TaskUpdateInput>(
      payload,
      timeZone,
    );

    const data: Prisma.TaskUpdateInput = commonData;

    try {
      const task = await this.prismaService.task.update({
        where: { id },
        data,
      });
      this.tasksHelper.notifyTaskChange(task.id, userId, userName, 'UPDATED');
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
  ): Promise<void> {
    /**
     * @TODO Refactpr request
     * Split into `claimTask` and `updateAssignmentStatus`
     * POST /tasks/:id/claim
     *
     * Updates the assignment status for a user on a specific task, handling self-claims and status reports.
     * * This method implements a "Group Task Assignment" workflow with two primary entry points:
     * 1. **Self-Claim (New Assignment)**: If the actor has no existing assignment for the task,
     * they can "claim" it by setting the status to 'ACCEPTED'. This creates a new assignment record.
     * 2. **Status Transition (Existing Assignment)**: If the actor is already assigned,
     * the method validates the state transition (e.g., ACCEPTED -> COMPLETED) against the current
     * task and assignment status.
     * * @param id - The unique identifier of the task.
     * @param actorId - The ID of the user performing the update (the actor).
     * @param dto - The data transfer object containing:
     * - `status`: The target AssignmentStatus the actor wants to transition to.
     * - `reason`: An optional string explaining the status change (e.g., for declining or reporting).
     * @param updatedBy - The display name of the actor, used for broadcasting notifications.
     * * @returns {Promise<void>} Resolves when the transaction is successfully committed and notifications are sent.
     * * @throws {Error} 'Task lost in transaction' if the task becomes unavailable during the atomic operation.
     * @throws {TasksErrors.TaskForbiddenError}
     * - Action: 'ILLEGAL_WITHOUT_ASSIGNMENT' if a non-assigned user attempts a status other than 'ACCEPTED'.
     * - Action: 'TRANSITION_ERROR' if the status change is invalid based on current assignment or task states.
     * - Action: 'UPDATE_ASSIGNEEE_STATUS_ON_PERSONAL_TASK' if try to update status for a non-group task
     */
    const { status: next, reason } = dto;
    let shouldNotify = false;

    return this.prismaService.$transaction(async (tx) => {
      // Check if task exitsts in transaction although we already checked in Guard,
      // for making sure the data status not changed during updating
      const task = await tx.task.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          groupId: true,
          assignees: {
            where: { assigneeId: actorId },
            select: { status: true },
          },
        },
      });

      if (!task) throw new Error('Task lost in transaction');
      // If not group task, throw error
      if (!task.groupId)
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actorId,
          task.id,
          'UPDATE_ASSIGNEEE_STATUS_ON_PERSONAL_TASK',
        );

      const currentAssignee = task.assignees[0];

      // 1. Deal with Self-claim (when no assigned record)
      if (!currentAssignee) {
        if (next !== AssignmentStatus.ACCEPTED) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            id,
            'ILLEGAL_WITHOUT_ASSIGNMENT',
          );
        }

        await tx.taskAssignee.create({
          data: {
            taskId: id,
            assigneeId: actorId,
            assignedById: actorId,
            status: AssignmentStatus.ACCEPTED,
            assignedAt: new Date(),
            acceptedAt: new Date(),
          },
        });
      } else {
        // 2. Deal with status changing (assigned record found)
        const isLegal = TasksUtils.isValidAssignmentTransition(
          currentAssignee.status,
          next,
          task.status,
        );
        if (!isLegal) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actorId,
            id,
            `TRANSITION_ERROR`,
          );
        }

        await tx.taskAssignee.update({
          where: { taskId_assigneeId: { taskId: id, assigneeId: actorId } },
          data: TasksUtils.getAssigneeUpdateData(next, reason),
        });

        shouldNotify = true;
      }
      if (shouldNotify) {
        this.tasksHelper.notifyTaskChange(
          id,
          actorId,
          updatedBy!,
          'ASSIGNEE_STATUS_UPDATED',
        );
      }
    });
  }

  async closeTask(
    ctx: TaskCloseContext,
    opts?: { reason?: string },
  ): Promise<Task> {
    /**
     * Closes a task and orchestrates the state transition of all related entities.
     * * This method implements a **"Restricted Management"** policy:
     * 1. **Standard Closure**: If the task and all sub-items are completed, the Task Owner or
     * a Group Administrator can close it.
     * 2. **Force Closure**: If the task still has open sub-tasks or active assignees,
     * ONLY a Group Administrator can perform a "Force Close," which requires a mandatory reason.
     * * @param ctx - The pre-validated task context provided by `TaskMemberGuard`.
     * - `id`: The unique identifier of the task.
     * - `userId`: The ID of the actor performing the closure.
     * - `userName`: The name of the actor (used for real-time notifications).
     * - `isOwner`: Boolean flag indicating if the actor owns the task.
     * - `isAdminish`: Boolean flag indicating if the actor has Admin/Owner privileges in the group.
     * @param opts - Configuration options for the closure.
     * - `reason`: The justification string required for force-closing tasks with open items.
     * * @returns {Promise<Task>} The updated Task record with `CLOSED` status.
     * * @throws {TasksErrors.TaskNotFoundError} If the task record is missing (Defensive check).
     * @throws {TasksErrors.TaskForbiddenError}
     * - Action: `FORCE_CLOSE_REASON_REQUIRED` when open items exist but no reason is provided.
     * - Action: `CLOSE_TASK` when a non-admin attempts a force-close or lacks general permissions.
     */
    const { id, userId: actorId, userName, isOwner, isAdminish } = ctx;

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
    if (task.status === TaskStatus.CLOSED) {
      return task as any;
    }

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
    const canPerformAction = isAdminish || (isOwner && !hasOpenItems);

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

    // 2. Execute Transaction to update task and related assignments/sub-tasks
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
      this.tasksHelper.notifyTaskChange(id, actorId, userName, 'UPDATED');
      return updatedTask;
    });
  }

  async archiveTask(
    id: number,
    actorId: number,
    isOwner: boolean,
    isAdminish: boolean,
    userName: string,
  ): Promise<void> {
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
        isOwner,
        isAdminish,
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
      this.tasksHelper.notifyTaskChange(id, actorId, userName, 'UPDATED');
    });
  }

  async restoreTask(
    id: number,
    actorId: number,
    isOwner: boolean,
    isAdminish: boolean,
    userName: string,
  ): Promise<void> {
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
        isOwner,
        isAdminish,
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
      this.tasksHelper.notifyTaskChange(id, actorId, userName, 'UPDATE');
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
    isOwner: boolean,
    isAdminish: boolean,
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
      return this.executeUpdateLogic(id, isOwner, isAdminish, opts, txHost);
    }

    // If not, open a new transaction
    return this.prismaService.$transaction(async (tx) => {
      return this.executeUpdateLogic(id, isOwner, isAdminish, opts, tx);
    });
  }

  private async executeUpdateLogic(
    id: number,
    isOwner: boolean,
    isAdminish: boolean,
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
    const allowed = isOwner || isAdminish;

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
    const isLegalTransition = TasksUtils.taskStatusCanTransition(
      from,
      newStatus,
    );

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
    const { startUtc, endUtc, todayDateOnlyUtc } =
      TasksUtils.getTaskBounds(timeZone);
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
      orderBy: TasksUtils.resolveOrderBy(orderByKey),
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

  // ------------------ Assign task -------------------

  async assignTask(payload: AssignTaskPayload): Promise<boolean | void> {
    const mailSent = await this.taskAssignmentManager.execute({
      type: 'TASK',
      targetId: payload.id,
      assigneeId: payload.assigneeId,
      assignerId: payload.assignerId,
      sendUrgentEmail: payload.sendUrgentEmail,
      updatedBy: payload.updatedBy,
    });

    return mailSent;
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
}
