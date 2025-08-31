import { Status, Priority } from '@prisma/client';

export interface TasksAddPayload {
  title: string;
  status: Status | null;
  priority: Priority | null;
  description: string | null;
  dueAt: string | null;
  location: string | null;
  userId: number;
}
