import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { InternalAssignOptions } from '../types/tasks';
import { TaskStatus } from '../types/enum';
import { TasksErrors } from 'src/errors';
import { AssignmentStatus, GroupRole } from 'src/generated/prisma/enums';
import { TasksUtils } from '../tasks.util';
import { TasksHelperService } from './helper.service';

@Injectable()
export class TaskAssignmentManager {
  constructor(
    private prismaService: PrismaService,
    private mailService: MailService,
    private tasksHelper: TasksHelperService,
    private config: ConfigService,
  ) {}

  async execute(options: InternalAssignOptions) {
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
     * * @returns {Promise<boolean>} A flag indicating whether an urgent email notification was sent.
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
    const {
      type,
      targetId,
      assigneeId,
      assignerId,
      sendUrgentEmail,
      updatedBy,
    } = options;

    // 1. Get basic infomation from type(Task or subTask)
    let groupId: number;
    let title: string;
    let priority: number;
    let description: string | null;
    let dueAt: Date | null;
    let redirectTaskId: number;
    let mailSent: boolean = false;

    const notifyType =
      type === 'TASK' ? 'ASSIGNMENT_UPDATED' : 'SUBTASK_UPDATED';

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

    if (type === 'TASK') {
      await this.prismaService.taskAssignee.upsert({
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
      await this.prismaService.subTaskAssignee.upsert({
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

      let taskUrl: string;
      let taskId: number;
      let subTaskId: number | undefined;
      if (assigneeUser?.email) {
        if (type === 'TASK') {
          taskUrl = `${this.config.get('BASE_URL')}tasks/${targetId}`;
          taskId = targetId;
          subTaskId = undefined;
        } else {
          taskUrl = `${this.config.get('BASE_URL')}tasks/${redirectTaskId}/sub-tasks/${targetId}`;
          taskId = redirectTaskId;
          subTaskId = targetId;
        }

        mailSent = await this.mailService.sendTaskAssignNotification({
          assigneeId,
          assigneeName: assigneeUser.name,
          email: assigneeUser.email,
          assignerName: assigner.user.name,
          taskId: taskId,
          subTaskId: subTaskId,
          groupName: assigner.group.name,
          taskTitle: title,
          priority: TasksUtils.mapPriorityToString(priority),
          dueAt: dueAt || null,
          description: description || 'No description provided.',
          taskUrl,
        });
      }
    }

    this.tasksHelper.notifyTaskChange(
      targetId,
      assignerId,
      updatedBy,
      notifyType,
    );

    return mailSent;
  }

  private async updateGenericStatus<T>(
    tx: any,
    options: {
      id: number;
      actorId: number;
      nextStatus: AssignmentStatus;
      reason?: string;
      updatedBy: string | null;
      // 關鍵：定義如何獲取資源與更新資源的行為
      fetchTarget: () => Promise<any>;
      updateRecord: (data: any) => Promise<T>;
      createRecord: (data: any) => Promise<T>;
      notifyType: 'TASK_UPDATED' | 'SUBTASK_UPDATED'; // 根據你的通知邏輯調整
    },
  ) {
    const {
      id,
      actorId,
      nextStatus,
      reason,
      updatedBy,
      fetchTarget,
      updateRecord,
      createRecord,
      notifyType,
    } = options;

    // 1. 取得資源 (Task 或 SubTask)
    const target = await fetchTarget();
    if (!target) throw new Error('Resource lost in transaction');

    // 檢查是否為群組任務 (防呆)
    if (!target.groupId && !target.task?.groupId) {
      throw new Error('Action only allowed on group resources');
    }

    const currentAssignee = target.assignees[0];
    let shouldNotify = false;

    // 2. 處理 Self-claim (無紀錄時)
    if (!currentAssignee) {
      if (nextStatus !== AssignmentStatus.ACCEPTED) {
        throw new Error('ILLEGAL_WITHOUT_ASSIGNMENT');
      }

      await createRecord({
        status: AssignmentStatus.ACCEPTED,
        assignedAt: new Date(),
        acceptedAt: new Date(),
        assignedById: actorId,
        assigneeId: actorId,
      });
      shouldNotify = true;
    }
    // 3. 處理狀態變更 (已有紀錄)
    else {
      const isLegal = TasksUtils.isValidAssignmentTransition(
        currentAssignee.status,
        nextStatus,
        target.status,
      );

      if (!isLegal) throw new Error('TRANSITION_ERROR');

      await updateRecord(TasksUtils.getAssigneeUpdateData(nextStatus, reason));
      shouldNotify = true;
    }

    // 4. 發送即時通知
    if (shouldNotify && updatedBy) {
      this.tasksHelper.notifyTaskChange(id, actorId, updatedBy, notifyType);
    }
  }

  async executeDecision(token: string, status: AssignmentStatus) {
    const { payload, accessPayload } =
      await this.tasksHelper.verifyDecisionAndGetAccess(token);

    return this.prismaService.$transaction(async (tx) => {
      if (payload.subTaskId) {
        // --- 處理 SubTask ---
        await this.updateGenericStatus(tx, {
          id: payload.subTaskId,
          actorId: payload.userId,
          nextStatus: status,
          updatedBy: accessPayload.userName,
          notifyType: 'SUBTASK_UPDATED',
          fetchTarget: () =>
            tx.subTask.findUnique({
              where: { id: payload.subTaskId },
              include: {
                task: { select: { groupId: true } },
                assignees: { where: { assigneeId: payload.userId } },
              },
            }),
          updateRecord: (data) =>
            tx.subTaskAssignee.update({
              where: {
                subTaskId_assigneeId: {
                  subTaskId: payload.subTaskId!,
                  assigneeId: payload.userId,
                },
              },
              data,
            }),
          createRecord: (data) =>
            tx.subTaskAssignee.create({
              data: { ...data, subTaskId: payload.subTaskId },
            }),
        });
      } else {
        // --- 處理 Task ---
        await this.updateGenericStatus(tx, {
          id: payload.taskId,
          actorId: payload.userId,
          nextStatus: status,
          updatedBy: accessPayload.userName,
          notifyType: 'TASK_UPDATED',
          fetchTarget: () =>
            tx.task.findUnique({
              where: { id: payload.taskId },
              include: { assignees: { where: { assigneeId: payload.userId } } },
            }),
          updateRecord: (data) =>
            tx.taskAssignee.update({
              where: {
                taskId_assigneeId: {
                  taskId: payload.taskId,
                  assigneeId: payload.userId,
                },
              },
              data,
            }),
          createRecord: (data) =>
            tx.taskAssignee.create({
              data: { ...data, taskId: payload.taskId },
            }),
        });
      }

      return {
        taskId: payload.taskId,
        subTaskId: payload.subTaskId,
        accessPayload,
      };
    });
  }
}
