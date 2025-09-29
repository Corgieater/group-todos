import { DomainError } from '../domain-error.base';

export class CannotInviteSelfError extends DomainError {
  constructor(opts?: { ownerId?: number; groupId?: number; cause?: unknown }) {
    super('CannotInviteSelfError', {
      code: 'CANNOT_INVITE_SELF_ERROR',
      message: 'You cannot invite yourself to your own group',
      cause: opts?.cause,
    });
  }

  static byOwner(ownerId: number, groupId: number) {
    return new CannotInviteSelfError({ ownerId, groupId });
  }
}
