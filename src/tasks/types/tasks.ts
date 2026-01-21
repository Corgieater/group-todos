import {
  Prisma,
  Task as TaskModel,
  SubTask as SubTaskModel,
  Task,
} from 'src/generated/prisma/client';
import { TaskStatus } from './enum';
import { TaskPriority } from './enum';

export interface TasksAddPayload {
  title: string;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  description: string | null;
  allDay: boolean;
  dueDate: string | null;
  dueTime: string | null;
  location: string | null;
  userId: number;
}

export interface SubTaskAddPayload extends Omit<TasksAddPayload, 'userId'> {
  parentTaskId: number;
  actorId: number;
  updatedBy: string;
}

export interface SubTaskWithAssignees extends SubTaskModel {
  assignees: Prisma.SubTaskAssigneeGetPayload<{
    include: {
      assignee: { select: { id: true; name: true; email: true } };
      assignedBy: { select: { id: true; name: true; email: true } };
    };
    orderBy: [{ acceptedAt: 'asc' }];
  }>[];
}

export interface TaskUpdatePayload {
  title?: string;
  priority?: TaskPriority;
  description?: string | null;
  allDay?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  location?: string | null;
}

// finish this
export const taskWithAssigneesArgs = {
  include: {
    assignees: {
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ acceptedAt: 'asc' as const }],
    },
  },
} satisfies Prisma.TaskDefaultArgs;

export type TaskWithAssignees = Prisma.TaskGetPayload<
  typeof taskWithAssigneesArgs
>;

export type UpdateStatusOpts = {
  target: TaskStatus; // 'CLOSED' | 'ARCHIVED' | 'OPEN'
  force?: boolean; // 僅當 target=CLOSED 且群組任務時有意義
  reason?: string | null; // force 時可選
  actorId: number;
};

// --- 輔助型別 (Helper Types) ---

// 用於 TaskAssignee 和 SubTaskAssignee 中指派人/指派者的選擇
export type UserSelectPayload = {
  select: { id: true; name: true; email: true };
};

// --- Task Assignee 載入型別 ---

export type TaskAssigneePayload = {
  include: {
    assignee: UserSelectPayload;
    assignedBy: UserSelectPayload;
  };
};
export type TaskAssigneeWithUsers =
  Prisma.TaskAssigneeGetPayload<TaskAssigneePayload>;

// --- SubTask Assignee 載入型別 ---

export type SubTaskAssigneePayload = {
  include: {
    assignee: UserSelectPayload;
    assignedBy: UserSelectPayload;
  };
};
export type SubTaskAssigneeWithUsers =
  Prisma.SubTaskAssigneeGetPayload<SubTaskAssigneePayload>;

// --- SubTask 載入型別 ---

/**
 * SubTask Model 包含其 SubTaskAssignees 及其 User 資訊。
 */
export interface SubTaskWithAssignees extends SubTaskModel {
  assignees: SubTaskAssigneeWithUsers[];
}

// --- 最終 Task 總體型別 ---

/**
 * Task Model 包含 Task Assignees 清單，以及其 SubTasks 清單 (SubTasks 中嵌套了 SubTaskAssignees)。
 */
export interface TaskWithAllDetails extends TaskModel {
  assignees: TaskAssigneeWithUsers[];
  subTasks: SubTaskWithAssignees[];

  // 根據您 service 曾 include 過 group: { select: { name: true } }
  group?: {
    name: string;
  } | null;
}

export interface GroupMemberInfo {
  id: number;
  userName: string;
}

export interface AssignTaskPayload {
  id: number;
  assigneeId: number;
  assignerName: string;
  assignerId: number;
  sendUrgentEmail?: boolean;
  updatedBy: string | null;
}

export interface InternalAssignOptions {
  type: 'TASK' | 'SUBTASK';
  targetId: number;
  parentId?: number; // 只有 SubTask 需要
  assigneeId: number;
  assignerId: number;
  sendUrgentEmail?: boolean;
}

export interface ListTasksResult {
  items: (Task & { assignees: any[]; canClose: boolean })[];
  bounds: {
    timeZone: string;
    startUtc: Date;
    endUtc: Date;
    todayDateOnlyUtc: Date;
  };
}
