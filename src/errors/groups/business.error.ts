import { DomainError } from '../domain-error.base';

export class OwnerRemovalForbiddenError extends DomainError<{
  groupId: number;
  actorId: number;
}> {
  readonly groupId: number;
  readonly actorId: number;

  constructor(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    super('OwnerRemovalForbiddenError', {
      code: 'OWNER_REMOVAL_FORBIDDEN_ERROR',
      message: 'Owner can not remove self from the group.',
      data: { groupId, actorId },
      cause: opts?.cause,
    });

    this.groupId = groupId;
    this.actorId = actorId;
  }

  static self(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    return new OwnerRemovalForbiddenError(groupId, actorId, opts);
  }
}

export class GroupPermissionError extends DomainError<{
  actorId: number;
  groupId: number;
}> {
  readonly actorId: number;
  readonly groupId: number;

  constructor(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    super('GroupPermissionError', {
      code: 'GROUP_PERMISSION_ERROR',
      message: 'You do not have permission to remove members from this group.',
      data: { groupId, actorId },
      cause: opts?.cause,
    });
    this.groupId = groupId;
    this.actorId = actorId;
  }

  static remove(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    return new GroupPermissionError(groupId, actorId, opts);
  }
}
