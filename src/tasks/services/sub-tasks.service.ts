import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AssignTaskPayload,
  GroupMemberInfo,
  SubTaskAddPayload,
  TaskUpdatePayload,
  UpdateStatusOpts,
  SubTaskWithAllDetails,
} from '../types/tasks';
import { AssignmentStatus, Prisma } from 'src/generated/prisma/client';

import { TaskStatus } from '../types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';

import { TasksUtils } from '../tasks.util';
import { TasksHelperService } from './helper.service';
import { TaskAssignmentManager } from './task-assignment.service';
/**
 * TODO:
 * 1. This service file is too big, we should separate Task and Subtask to another service.
 * 2. Pay attention on repeatedly logics when refactor
 */

@Injectable()
export class SubTasksService {
  constructor(
    private prismaService: PrismaService,
    private readonly tasksHelper: TasksHelperService,
    private readonly taskAssignmentManager: TaskAssignmentManager,
  ) {}
  // ----------------- SubTask -----------------

  async createSubTask(payload: SubTaskAddPayload): Promise<void> {
    // 1. Get parent task info and acotr time zone for time transition
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: payload.parentTaskId },
      select: {
        id: true,
        ownerId: true,
        groupId: true,
      },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(
        payload.actorId,
        payload.parentTaskId,
      );
    }

    // 2. Permission check
    if (!parentTask.groupId && parentTask.ownerId !== payload.actorId) {
      // Personaly task only allowed owner add subTasks
      throw TasksErrors.TaskForbiddenError.byActorOnTask(
        payload.actorId,
        payload.parentTaskId,
        'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
      );
    }

    // 2. Core daytime logic (deal with infinite)
    const { dueAtUtc, allDayLocalDate } = TasksUtils.calculateTaskDates(
      payload.allDay,
      payload.dueDate,
      payload.dueTime,
      payload.timeZone,
    );

    // 3. Build prisma obj
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
    this.tasksHelper.notifyTaskChange(
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
    subTask: SubTaskWithAllDetails;
    isAdminish: boolean;
    isRealAdmin: boolean; // 🚀 新增：對齊 getTaskForViewer
    groupMembers: GroupMemberInfo[];
  }> {
    // 1. 取得父任務資訊（基礎檢查）
    const parentTask = await this.prismaService.task.findUnique({
      where: { id: parentId },
      select: { id: true, ownerId: true, groupId: true },
    });

    if (!parentTask) {
      throw TasksErrors.TaskNotFoundError.byId(actorId, parentId);
    }

    // 2. 核心查詢：取得子任務詳細資訊
    const subTask = await this.prismaService.subTask.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            ownerId: true, // 👈 為了讓 Pug 判斷 isOwner
            groupId: true, // 👈 為了讓 Controller 判斷 allowSelfAssign
          },
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

    // 3. 權限判斷 (與 getTaskForViewer 邏輯同步)
    let isGroupAdmin = false;
    const isTaskOwner = parentTask.ownerId === actorId;

    if (!parentTask.groupId) {
      // 個人任務：只有擁有者能看
      if (!isTaskOwner) {
        throw TasksErrors.TaskNotFoundError.byId(actorId, id);
      }
      // 個人任務中，Owner 本身就是管理員
      isGroupAdmin = true;
    } else {
      // 群組任務：檢查成員身分
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

      // 真正的群組管理員身分 (ADMIN/OWNER)
      isGroupAdmin = TasksUtils.isAdminish(member.role);
    }

    // 4. 取得群組成員清單（供指派下拉選單使用）
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
      subTask: subTask as any, // 確保型別包含 task
      isAdminish: isGroupAdmin || isTaskOwner,
      isRealAdmin: isGroupAdmin,
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
    const data = TasksUtils.getCommonUpdateData<Prisma.SubTaskUpdateInput>(
      payload,
      actorTz,
    );

    // 5. Update
    await this.prismaService.subTask.update({
      where: { id },
      data,
    });
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
      const legal = TasksUtils.taskStatusCanTransition(from, newStatus);

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

        this.tasksHelper.notifyTaskChange(
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
      const isLegal = TasksUtils.isValidAssignmentTransition(
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
      const updateData = TasksUtils.getAssigneeUpdateData(next, reason);

      await tx.subTaskAssignee.update({
        where: { subTaskId_assigneeId: { subTaskId, assigneeId: actorId } },
        data: updateData,
      });

      return { ok: true };
    });
  }

  // ------------------ Assign task -------------------

  async assignSubTask(payload: AssignTaskPayload) {
    return this.taskAssignmentManager.execute({
      type: 'SUBTASK',
      targetId: payload.id,
      assigneeId: payload.assigneeId,
      assignerId: payload.assignerId,
      sendUrgentEmail: payload.sendUrgentEmail,
    });
  }

  // ------------- assignment --------------------

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
}
