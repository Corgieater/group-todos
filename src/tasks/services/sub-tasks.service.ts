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
import { AssignmentStatus, Prisma, User } from 'src/generated/prisma/client';

import { TaskStatus } from '../types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';

import { TasksUtils } from '../tasks.util';
import { TasksHelperService } from './helper.service';
import { TaskAssignmentManager } from './task-assignment.service';
import { CurrentUser } from 'src/common/types/current-user';
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

  async createSubTask(payload: SubTaskAddPayload): Promise<void> {
    // 1. Get parent task info
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
    const exists = await this.prismaService.subTask.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) throw TasksErrors.TaskNotFoundError.byId(actorId, id);

    const data = TasksUtils.getCommonUpdateData<Prisma.SubTaskUpdateInput>(
      payload,
      actorTz,
    );

    await this.prismaService.subTask.update({
      where: { id },
      data,
    });
  }

  async closeSubTask(
    parentId: number,
    id: number,
    user: CurrentUser,
    opts?: { reason?: string },
  ) {
    const subTask = await this.prismaService.subTask.findUnique({
      where: {
        id,
      },

      select: {
        id: true,
      },
    });

    if (!subTask) throw TasksErrors.TaskNotFoundError.byId(user.userId, id);

    const result = await this.prismaService.$transaction(async (tx) => {
      const updateSubTask = await tx.subTask.update({
        where: { id },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          closedById: user.userId,
          closedReason: opts?.reason ?? null,
        },
      });

      // check if this subTask belongs to actor
      const isActorsAssignment = await tx.subTaskAssignee.findUnique({
        where: {
          subTaskId_assigneeId: { subTaskId: id, assigneeId: user.userId },
        },
        select: { status: true },
      });

      if (
        !isActorsAssignment ||
        isActorsAssignment.status !== AssignmentStatus.COMPLETED
      ) {
        await tx.subTaskAssignee.upsert({
          where: {
            subTaskId_assigneeId: { subTaskId: id, assigneeId: user.userId },
          },
          update: {
            status: AssignmentStatus.COMPLETED, // 或是自訂一個 COMPLETED 狀態
          },
          create: {
            subTaskId: id,
            assigneeId: user.userId,
            assignedById: user.userId, // 自己領的
            status: AssignmentStatus.COMPLETED,
            acceptedAt: new Date(),
          },
        });
      }

      await tx.subTaskAssignee.updateMany({
        where: { subTaskId: id, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.DROPPED, updatedAt: new Date() },
      });

      await tx.subTaskAssignee.updateMany({
        where: { subTaskId: id, status: AssignmentStatus.PENDING },
        data: { status: AssignmentStatus.SKIPPED, updatedAt: new Date() },
      });
      return updateSubTask;
    });
    this.tasksHelper.notifyTaskChange(
      parentId,
      user.userId,
      user.userName,
      'CLOSE_SUBTASK',
    );
    this.tasksHelper.notifySubTaskChange(
      parentId,
      id,
      user.userId,
      user.userName,
      'CLOSE_SUBTASK',
    );
    return result;
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

  async restoreSubTask(parentId: number, id: number, user: CurrentUser) {
    /**
     * A method for restore closed or archived task
     *
     * *@todo
     * Should check authentication
     */
    const result = await this.prismaService.$transaction(async (tx) => {
      await tx.subTask.update({
        where: { id },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      await tx.subTaskAssignee.updateMany({
        where: { subTaskId: id, status: AssignmentStatus.DROPPED },
        data: { status: AssignmentStatus.ACCEPTED, updatedAt: new Date() }, // 恢復到「已接受」
      });

      await tx.subTaskAssignee.updateMany({
        where: { subTaskId: id, status: AssignmentStatus.SKIPPED },
        data: { status: AssignmentStatus.PENDING, updatedAt: new Date() }, // 恢復到「待處理」
      });
    });

    this.tasksHelper.notifySubTaskChange(
      parentId,
      id,
      user.userId,
      user.userName,
      'RESTORE_SUBTASK',
    );

    this.tasksHelper.notifyTaskChange(
      parentId,
      user.userId,
      user.userName,
      'RESTORE_SUBTASK',
    );
    return result;
  }

  // subtask指派狀態更新, self-assign, claim相關
  // TODO: claim要分開
  async updateSubTaskAssigneeStatus(
    parentId: number,
    id: number,
    actor: CurrentUser,
    dto: { status: AssignmentStatus; reason?: string },
  ) {
    const { status: next, reason } = dto;

    // 🚀 執行資料庫事務
    await this.prismaService.$transaction(async (tx) => {
      // 1. 僅獲取必要的父任務 ID (為了後續通知)
      const subTask = await tx.subTask.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!subTask) throw TasksErrors.TaskNotFoundError.byId(actor.userId, id);

      // 2. 檢查指派紀錄
      const assignee = await tx.subTaskAssignee.findUnique({
        where: {
          subTaskId_assigneeId: { subTaskId: id, assigneeId: actor.userId },
        },
        select: { status: true },
      });

      // 3. 自領邏輯 (Self-claim)
      if (!assignee) {
        if (next !== AssignmentStatus.ACCEPTED) {
          throw TasksErrors.TaskForbiddenError.byActorOnTask(
            actor.userId,
            id,
            'ASSIGNEE_STATUS_ILLEGAL_WITHOUT_ASSIGNMENT',
          );
        }

        await tx.subTaskAssignee.create({
          data: {
            subTaskId: id,
            assigneeId: actor.userId,
            assignedById: actor.userId,
            status: AssignmentStatus.ACCEPTED,
            assignedAt: new Date(),
            acceptedAt: new Date(),
          },
        });

        this.tasksHelper.notifySubTaskChange(
          parentId,
          id,
          actor.userId,
          actor.userName,
          'SUBTASK_STATUS_UPDATED',
        );
        this.tasksHelper.notifyTaskChange(
          parentId,
          actor.userId,
          actor.userName,
          'SUBTASK_STATUS_UPDATED',
        );
        return; // 結束 transaction
      }

      // 4. 狀態轉移檢查 (isValidAssignmentTransition)
      const isLegal = TasksUtils.isValidAssignmentTransition(
        assignee.status,
        next,
        subTask.status,
      );
      if (!isLegal) {
        throw TasksErrors.TaskForbiddenError.byActorOnTask(
          actor.userId,
          id,
          `ASSIGNEE_STATUS_ILLEGAL_TRANSITION_${assignee.status}_TO_${next}`,
        );
      }

      // 5. 更新狀態
      await tx.subTaskAssignee.update({
        where: {
          subTaskId_assigneeId: { subTaskId: id, assigneeId: actor.userId },
        },
        data: TasksUtils.getAssigneeUpdateData(next, reason),
      });
    });

    // 🚀 交易成功後，才發送 Socket 通知
    this.tasksHelper.notifySubTaskChange(
      parentId,
      id,
      actor.userId,
      actor.userName,
      'SUBTASK_STATUS_UPDATED',
    );

    return { ok: true };
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

  //   async updateAssigneeStatus(
  //     id: number,
  //     actorId: number,
  //     dto: { status: AssignmentStatus; reason?: string },
  //     updatedBy: string | null = null,
  //   ): Promise<void> {
  //     /**
  //      * @TODO Refactpr request
  //      * Split into `claimTask` and `updateAssignmentStatus`
  //      * POST /tasks/:id/claim
  //      *
  //      * Updates the assignment status for a user on a specific task, handling self-claims and status reports.
  //      * * This method implements a "Group Task Assignment" workflow with two primary entry points:
  //      * 1. **Self-Claim (New Assignment)**: If the actor has no existing assignment for the task,
  //      * they can "claim" it by setting the status to 'ACCEPTED'. This creates a new assignment record.
  //      * 2. **Status Transition (Existing Assignment)**: If the actor is already assigned,
  //      * the method validates the state transition (e.g., ACCEPTED -> COMPLETED) against the current
  //      * task and assignment status.
  //      * * @param id - The unique identifier of the task.
  //      * @param actorId - The ID of the user performing the update (the actor).
  //      * @param dto - The data transfer object containing:
  //      * - `status`: The target AssignmentStatus the actor wants to transition to.
  //      * - `reason`: An optional string explaining the status change (e.g., for declining or reporting).
  //      * @param updatedBy - The display name of the actor, used for broadcasting notifications.
  //      * * @returns {Promise<void>} Resolves when the transaction is successfully committed and notifications are sent.
  //      * * @throws {Error} 'Task lost in transaction' if the task becomes unavailable during the atomic operation.
  //      * @throws {TasksErrors.TaskForbiddenError}
  //      * - Action: 'ILLEGAL_WITHOUT_ASSIGNMENT' if a non-assigned user attempts a status other than 'ACCEPTED'.
  //      * - Action: 'TRANSITION_ERROR' if the status change is invalid based on current assignment or task states.
  //      * - Action: 'UPDATE_ASSIGNEEE_STATUS_ON_PERSONAL_TASK' if try to update status for a non-group task
  //      */
  //     const { status: next, reason } = dto;
  //     let shouldNotify = false;

  //     return this.prismaService.$transaction(async (tx) => {
  //       // Check if task exitsts in transaction although we already checked in Guard,
  //       // for making sure the data status not changed during updating
  //       const task = await tx.task.findUnique({
  //         where: { id },
  //         select: {
  //           id: true,
  //           status: true,
  //           groupId: true,
  //           assignees: {
  //             where: { assigneeId: actorId },
  //             select: { status: true },
  //           },
  //         },
  //       });

  //       if (!task) throw new Error('Task lost in transaction');
  //       // If not group task, throw error
  //       if (!task.groupId)
  //         throw TasksErrors.TaskForbiddenError.byActorOnTask(
  //           actorId,
  //           task.id,
  //           'UPDATE_ASSIGNEEE_STATUS_ON_PERSONAL_TASK',
  //         );

  //       const currentAssignee = task.assignees[0];

  //       // 1. Deal with Self-claim (when no assigned record)
  //       if (!currentAssignee) {
  //         if (next !== AssignmentStatus.ACCEPTED) {
  //           throw TasksErrors.TaskForbiddenError.byActorOnTask(
  //             actorId,
  //             id,
  //             'ILLEGAL_WITHOUT_ASSIGNMENT',
  //           );
  //         }

  //         await tx.taskAssignee.create({
  //           data: {
  //             taskId: id,
  //             assigneeId: actorId,
  //             assignedById: actorId,
  //             status: AssignmentStatus.ACCEPTED,
  //             assignedAt: new Date(),
  //             acceptedAt: new Date(),
  //           },
  //         });
  //       } else {
  //         // 2. Deal with status changing (assigned record found)
  //         const isLegal = TasksUtils.isValidAssignmentTransition(
  //           currentAssignee.status,
  //           next,
  //           task.status,
  //         );
  //         if (!isLegal) {
  //           throw TasksErrors.TaskForbiddenError.byActorOnTask(
  //             actorId,
  //             id,
  //             `TRANSITION_ERROR`,
  //           );
  //         }

  //         await tx.taskAssignee.update({
  //           where: { taskId_assigneeId: { taskId: id, assigneeId: actorId } },
  //           data: TasksUtils.getAssigneeUpdateData(next, reason),
  //         });

  //         shouldNotify = true;
  //       }
  //       if (shouldNotify) {
  //         this.tasksHelper.notifySubTaskChange(
  //           parentId,
  //           id,
  //           actorId,
  //           updatedBy!,
  //           'ASSIGNEE_STATUS_UPDATED',
  //         );
  //       }
  //     });
  //   }
}
