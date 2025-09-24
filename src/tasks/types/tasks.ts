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

export interface TaskUpdatePayload {
  title?: string;
  priority?: TaskPriority;
  description?: string | null;
  allDay?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  location?: string | null;
}
