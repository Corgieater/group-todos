import { $Enums } from '@prisma/client';
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

type GroupRole = $Enums.GroupRole;

export class NotAuthorizedToRemoveMemberError extends DomainError {
  constructor(opts: {
    groupId: number;
    actorId: number; // 執行移除的人
    actorRole?: GroupRole; // 他的實際角色
    allowedRoles?: GroupRole[]; // 允許執行此操作的角色集合
    targetUserId?: number; // 被移除的人
    cause?: unknown;
  }) {
    super('NotAuthorizedToRemoveMemberError', {
      code: 'NOT_AUTHORIZED_TO_REMOVE_MEMBER',
      message: 'You are not allowed to remove this member.',
      data: {
        groupId: opts.groupId,
        actorId: opts.actorId,
        actorRole: opts.actorRole,
        allowedRoles: opts.allowedRoles,
        targetUserId: opts.targetUserId,
      },
      cause: opts.cause,
    });
  }

  static byRole(
    groupId: number,
    actorId: number,
    actorRole: GroupRole,
    allowedRoles: GroupRole[],
    targetUserId?: number,
  ) {
    return new NotAuthorizedToRemoveMemberError({
      groupId,
      actorId,
      actorRole,
      allowedRoles,
      targetUserId,
    });
  }

  static byId(groupId: number, actorId: number, targetUserId: number) {
    return new NotAuthorizedToRemoveMemberError({
      groupId,
      actorId,
      targetUserId,
    });
  }
}
