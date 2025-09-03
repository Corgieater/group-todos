import { DomainError } from '../domain-error.base';

export class TaskNotFoundError extends DomainError {
  private constructor(opts?: { userId?: number; taskId?: number }) {
    super('TaskNotFoundError', {
      code: 'TASK_NOT_FOUND',
      message: 'Task was not found',
      data: opts,
    });
  }

  static byId(userId: number, taskId: number) {
    return new TaskNotFoundError({ userId, taskId });
  }
}
