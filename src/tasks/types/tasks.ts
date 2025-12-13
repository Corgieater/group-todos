import { Prisma } from 'src/generated/prisma/client';
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
