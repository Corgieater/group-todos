import { DomainError } from '../domain-error.base';

export class GroupNotFoundError extends DomainError {
  readonly actorId: number;
  readonly groupId: number;

  constructor(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    super('GroupNotFoundError', {
      code: 'GROUP_NOT_FOUND',
      message: 'Group was not found',
      data: { actorId, groupId },
      cause: opts?.cause,
    });
    this.actorId = actorId;
    this.groupId = groupId;
  }

  static byId(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    return new GroupNotFoundError(actorId, groupId, opts);
  }
}
