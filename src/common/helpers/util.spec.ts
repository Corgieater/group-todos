import type { Task } from '@prisma/client';
import { createMockTask } from 'src/test/factories/mock-task.factory';
import { buildTaskVM } from './util';

const allDayTask: Task = createMockTask({
  allDay: true,
  allDayLocalDate: new Date('2025-09-01T00:00:00.000Z'),
});

const specificTimeTask: Task = createMockTask({
  allDay: false,
  dueAtUtc: new Date('2025-09-01T02:39:00.000Z'),
});

const noDueDayTask: Task = createMockTask({
  dueAtUtc: null,
  allDay: false,
  allDayLocalDate: null,
});

describe('buildTaskVM', () => {
  it('should return all day formats - allDayLocalDate as YYYY-MM-DD and clears time', () => {
    const viewModel = buildTaskVM(allDayTask, 'Asia/Taipei');
    expect(viewModel.dueDateLocal).toBe('2025-09-01');
    expect(viewModel.dueTimeLocal).toBeNull();
    expect(viewModel.dueLabel).toBe('2025-09-01');

    expect(viewModel.id).toBe(1);
    expect(viewModel.title).toBe('low test');
    expect(viewModel.createdAt).toBeInstanceOf(Date);
    expect(viewModel.updatedAt).toBeInstanceOf(Date);
  });

  it('should return specific day formats to local date/time (Asia/Taipei)', () => {
    const viewModel = buildTaskVM(specificTimeTask, 'Asia/Taipei');
    expect(viewModel.allDay).toBeFalsy();
    expect(viewModel.dueTimeLocal).toBe('10:39');
    expect(viewModel.dueDateLocal).toBe('2025-09-01');
  });

  it('should return specific day formats to local date/time (Europe/London)', () => {
    const viewModel = buildTaskVM(specificTimeTask, 'Europe/London');
    expect(viewModel.allDay).toBeFalsy();
    expect(viewModel.dueDateLocal).toBe('2025-09-01');
    expect(viewModel.dueTimeLocal).toBe('03:39');
    expect(viewModel.dueDateLocal).toBe('2025-09-01');
  });

  it('when no due fields: dueLabel/date/time are null', () => {
    const viewModel = buildTaskVM(noDueDayTask, 'UTC');
    expect(viewModel.dueLabel).toBeNull();
    expect(viewModel.dueDateLocal).toBeNull();
    expect(viewModel.dueTimeLocal).toBeNull();
  });
});
