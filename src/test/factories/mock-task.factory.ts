import {
  CompletionPolicy,
  type Task as TaskModel,
} from 'src/generated/prisma/client';
import { TaskStatus } from 'src/tasks/types/enum';
import { TaskPriority } from 'src/tasks/types/enum';

export function createMockTask(overrides: Partial<TaskModel> = {}): TaskModel {
  return {
    id: 1,
    ownerId: 1,
    groupId: null,
    title: 'low test',
    status: TaskStatus.OPEN,
    priority: TaskPriority.LOW,
    description: 'test',
    location: 'test',
    dueAtUtc: null,
    allDay: false,
    allDayLocalDate: null,
    sourceTimeZone: null,
    completionPolicy: CompletionPolicy.ALL_ASSIGNEES,
    closedAt: null,
    closedById: null,
    closedReason: null,
    closedWithOpenAssignees: false,
    createdAt: new Date('2025-09-01T05:49:55.797Z'),
    updatedAt: new Date('2025-09-01T05:49:55.797Z'),

    ...overrides,
  };
}
