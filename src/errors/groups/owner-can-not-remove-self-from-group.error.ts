import { DomainError } from '../domain-error.base';

export class OwnerCanNotRemoveSelfFromGroup extends DomainError<{
  ownerId: number;
  groupId: number;
}> {
  readonly ownerId: number;
  readonly groupId: number;

  constructor(ownerId: number, groupId: number, opts?: { cause?: unknown }) {
    super('OwnerCanNotRemoveSelfFromGroup', {
      code: 'OWNER_CAN_NOT_REMOVE_SELF_FROM_GROUP',
      message: 'Owner can not remove self from the group.',
      data: { ownerId, groupId },
      cause: opts?.cause,
    });
    this.ownerId = ownerId;
    this.groupId = groupId;
  }

  static byId(ownerId: number, groupId: number, opts?: { cause?: unknown }) {
    return new OwnerCanNotRemoveSelfFromGroup(ownerId, groupId, opts);
  }
}
