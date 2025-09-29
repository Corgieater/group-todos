import { DomainError } from '../domain-error.base';

export class GroupNotFoundError extends DomainError {
  constructor(opts?: { ownerId?: number; groupId?: number; cause?: unknown }) {
    super('GroupNotFoundError', {
      code: 'GROUP_NOT_FOUND',
      message: 'Group was not found',
      cause: opts?.cause,
    });
  }

  static byId(ownerId: number, groupId: number) {
    return new GroupNotFoundError({ ownerId, groupId });
  }
}
