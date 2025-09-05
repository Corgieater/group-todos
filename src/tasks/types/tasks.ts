import { Status } from '@prisma/client';
import { TaskPriority } from './enum';

export interface TasksAddPayload {
  title: string;
  status: Status | null;
  priority: TaskPriority | null;
  description: string | null;
  dueAt: string | null;
  location: string | null;
  userId: number;
}

export interface TaskUpdatePayload {
  title?: string;
  priority?: TaskPriority;
  description?: string;
  dueAt?: string;
  location?: string;
}
