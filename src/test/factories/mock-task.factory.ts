import type { Task as TaskModel } from '@prisma/client';
import { TaskStatus } from 'src/tasks/types/enum';
import { TaskPriority } from 'src/tasks/types/enum';

export function createMockTask(overrides: Partial<TaskModel> = {}): TaskModel {
  return {
    id: 1,
    ownerId: 1,
    groupId: null,
    title: 'low test',
    status: TaskStatus.UNFINISHED,
    priority: TaskPriority.LOW,
    description: 'test',
    location: 'test',
    dueAtUtc: null,
    allDay: false,
    allDayLocalDate: null,
    sourceTimeZone: null,
    createdAt: new Date('2025-09-01T05:49:55.797Z'),
    updatedAt: new Date('2025-09-01T05:49:55.797Z'),
    ...overrides,
  };
}
