import { DomainError, DomainErrorCode } from '../domain-error.base';

export class GroupOwnerConstraintError extends DomainError {
  // 🚀 關鍵修正：將 code 的型別限縮，確保它符合 DomainErrorCode 的樣板
  constructor(opts: {
    code: string;
    message: string;
    groupId: number;
    ownerId: number;
    targetId?: number;
    actorId?: number;
  }) {
    const errorCode = `OWNER_${opts.code.toUpperCase()}` as DomainErrorCode;

    super('GroupOwnerConstraintError', {
      code: errorCode,
      message: opts.message,
      data: {
        groupId: opts.groupId,
        ownerId: opts.ownerId,
        targetId: opts.targetId,
      },
    });
  }

  static cannotLeave(groupId: number, ownerId: number) {
    return new GroupOwnerConstraintError({
      code: 'CANNOT_LEAVE',
      message: 'Owner cannot leave the group without transferring ownership.',
      groupId,
      ownerId,
    });
  }

  static cannotBeRemoved(groupId: number, ownerId: number) {
    return new GroupOwnerConstraintError({
      code: 'REMOVAL_FORBIDDEN',
      message: 'Owner cannot be removed from the group.',
      groupId,
      ownerId,
    });
  }

  static ownerCanNotRemoveThemselves(groupId: number, ownerId: number) {
    return new GroupOwnerConstraintError({
      code: 'OWNER_CAN_NOT_REMOVE_THEMSELVES',
      message: 'Owner can not remove themselves.',
      groupId,
      ownerId,
    });
  }

  static ownerRoleCanNotBeUpdated(
    groupId: number,
    ownerId: number,
    actorId: number,
  ) {
    return new GroupOwnerConstraintError({
      code: 'OWNER_ROLE_CAN_NOT_BE_UPDATED',
      message: 'Owner role can not be updated.',
      groupId,
      ownerId,
      actorId,
    });
  }
}
