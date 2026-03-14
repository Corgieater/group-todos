import {
  Prisma,
  Task as TaskModel,
  SubTask as SubTaskModel,
  Task,
} from 'src/generated/prisma/client';
import { TaskStatus } from './enum';
import { TaskPriority } from './enum';

export type OrderKey = 'dueAtAscNullsLast' | 'createdAsc' | 'expiredPriority';

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
  timeZone: string;
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

export type SubTaskWithAllDetails = Prisma.SubTaskGetPayload<{
  include: {
    // 🚀 包含父任務，為了獲取 ownerId 與 groupId
    task: {
      select: { id: true; ownerId: true; groupId: true };
    };
    // 🚀 包含關閉者資訊 (用於詳情頁顯示)
    closedBy: {
      select: { id: true; name: true };
    };
    // 🚀 包含指派者資訊
    assignees: {
      include: {
        assignee: { select: { id: true; name: true; email: true } };
        assignedBy: { select: { id: true; name: true; email: true } };
      };
    };
  };
}>;

export interface TaskContext {
  task: Task;
  userId: number;
  isAdminish: boolean;
  isMember: boolean;
  isOwner: boolean;
}

export interface TaskUpdateContext
  extends Pick<TaskContext, 'userId' | 'isAdminish' | 'isOwner'> {
  id: number;
  timeZone: string;
  userName: string;
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

export interface TaskCloseContext
  extends Pick<TaskContext, 'userId' | 'isAdminish' | 'isOwner'> {
  id: number;
  userName: string;
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
  newStatus: TaskStatus; // 'CLOSED' | 'ARCHIVED' | 'OPEN'
  force?: boolean; // 僅當 newStatus=CLOSED 且群組任務時有意義
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
  updatedBy?: string;
}

export interface InternalAssignOptions {
  type: 'TASK' | 'SUBTASK';
  targetId: number;
  parentId?: number; // 只有 SubTask 需要
  assigneeId: number;
  assignerId: number;
  sendUrgentEmail?: boolean;
  updatedBy?: string;
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
