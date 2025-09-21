import { DomainError } from '../domain-error.base';

export class TaskNotFoundError extends DomainError {
  constructor(opts?: { userId?: number; taskId?: number; cause?: unknown }) {
    super('TaskNotFoundError', {
      code: 'TASK_NOT_FOUND',
      message: 'Task was not found',
      cause: opts?.cause,
    });
  }

  static byId(userId: number, taskId: number) {
    return new TaskNotFoundError({ userId, taskId });
  }
}
