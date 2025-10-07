import { DomainError } from '../domain-error.base';

export class NotAuthorizedToInviteMember extends DomainError {
  readonly actorId: number;
  readonly groupId: number;

  constructor(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    super('NotAuthorizedToInviteMember', {
      code: 'NOT_AUTHORIZED_TO_INVITE_MEMBER',
      message: 'Only group admin or member can invite members.',
      data: { actorId, groupId },
      cause: opts?.cause,
    });
    this.actorId = actorId;
    this.groupId = groupId;
  }

  static byId(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    return new NotAuthorizedToInviteMember(actorId, groupId, opts);
  }
}
