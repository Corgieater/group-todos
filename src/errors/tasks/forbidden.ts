import { DomainError } from '../domain-error.base';

export class TaskForbiddenError extends DomainError {
  readonly actorId: number;
  readonly taskId: number;
  readonly action?: string;
  constructor(
    actorId: number,
    taskId: number,
    action?: string,
    opts?: { cause?: unknown },
  ) {
    super('TaskForbiddenError', {
      code: 'TASK_FORBIDDEN',
      message: 'You are not allowed to perform this action on the task.',
      cause: opts?.cause,
    });
    this.actorId = actorId;
    this.taskId = taskId;
    this.action = action;
  }

  static byActorOnTask(
    actorId: number,
    taskId: number,
    action?: string,
    opts?: { cause?: unknown },
  ) {
    return new TaskForbiddenError(actorId, taskId, action, opts);
  }
}
