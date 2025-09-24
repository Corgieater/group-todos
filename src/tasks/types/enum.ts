import type { Status as PrismaStatus } from '@prisma/client';

export const TaskStatus = {
  UNFINISHED: 'UNFINISHED',
  FINISHED: 'FINISHED',
  ARCHIVED: 'ARCHIVED',
} as const satisfies Record<PrismaStatus, PrismaStatus>;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TaskStatusValues = Object.values(TaskStatus);

export enum TaskPriority {
  URGENT = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
}
