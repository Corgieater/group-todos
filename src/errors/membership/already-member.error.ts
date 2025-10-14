import { DomainError } from '../domain-error.base';

export class AlreadyMemberError extends DomainError {
  constructor(opts?: {
    inviteeId?: number;
    groupId?: number;
    cause?: unknown;
  }) {
    super('AlreadyMemberError', {
      code: 'ALREADY_MEMBER',
      message: 'This user is already a group member',
      cause: opts?.cause,
      data: opts
        ? { inviteeId: opts.inviteeId, groupId: opts.groupId }
        : undefined,
    });
  }

  static byId(inviteeId: number, groupId: number) {
    return new AlreadyMemberError({ inviteeId, groupId });
  }
}
