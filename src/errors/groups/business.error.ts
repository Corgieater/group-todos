import { DomainError } from '../domain-error.base';

export class OwnerRemovalForbiddenError extends DomainError<{
  groupId: number;
  actorId: number;
}> {
  readonly groupId: number;
  readonly actorId: number;

  constructor(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    super('OwnerRemovalForbiddenError', {
      code: 'OWNER_REMOVAL_FORBIDDEN',
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

export class OwnerDowngradeForbiddenError extends DomainError<{
  groupId: number;
  actorId: number;
}> {
  readonly groupId: number;
  readonly actorId: number;

  constructor(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    super('OwnerDowngradeForbiddenError', {
      code: 'OWNER_DOWNGRADE_FORBIDDEN',
      message: 'Owner can not downgrade self from the group.',
      data: { groupId, actorId },
      cause: opts?.cause,
    });

    this.groupId = groupId;
    this.actorId = actorId;
  }

  static self(groupId: number, actorId: number, opts?: { cause?: unknown }) {
    return new OwnerDowngradeForbiddenError(groupId, actorId, opts);
  }
}

export class OwnerCanNotLeaveTheGroupError extends DomainError<{
  groupId: number;
  ownerId: number;
}> {
  readonly groupId: number;
  readonly ownerId: number;

  constructor(groupId: number, ownerId: number, opts?: { cause?: unknown }) {
    super('OwnerCanNotLeaveTheGroupError', {
      code: 'OWNER_CAN_NOT_LEAVE_THE_GROUP',
      message: 'Owner can not downgrade self from the group.',
      data: { groupId, ownerId },
      cause: opts?.cause,
    });

    this.groupId = groupId;
    this.ownerId = ownerId;
  }

  static self(groupId: number, ownerId: number, opts?: { cause?: unknown }) {
    return new OwnerCanNotLeaveTheGroupError(groupId, ownerId, opts);
  }
}

export class OwnerRoleChangeForbiddenError extends DomainError<{
  groupId: number;
  actorId: number;
  targetId: number;
}> {
  readonly groupId: number;
  readonly actorId: number;
  readonly targetId: number;

  constructor(
    groupId: number,
    actorId: number,
    targetId: number,
    opts?: { cause?: unknown },
  ) {
    super('OwnerRoleChangeForbiddenError', {
      code: 'OWNER_ROLE_CHANGE_FORBIDDEN',
      message: 'Owner role can not be changed.',
      data: { groupId, actorId, targetId },
      cause: opts?.cause,
    });

    this.groupId = groupId;
    this.actorId = actorId;
    this.targetId = targetId;
  }

  static targetIsOwner(
    groupId: number,
    actorId: number,
    targetId: number,

    opts?: { cause?: unknown },
  ) {
    return new OwnerRoleChangeForbiddenError(groupId, actorId, targetId, opts);
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
      code: 'GROUP_PERMISSION',
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

  static updateRole(
    groupId: number,
    actorId: number,
    opts?: { cause?: unknown },
  ) {
    return new GroupPermissionError(groupId, actorId, opts);
  }
}
