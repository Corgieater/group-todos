import { $Enums } from 'src/generated/prisma/client';
import { DomainError } from '../domain-error.base';

type GroupRole = $Enums.GroupRole;

export class GroupActionForbiddenError extends DomainError {
  constructor(opts: {
    groupId: number;
    actorId: number;
    actorRole?: GroupRole;
    action: string;
    allowedRoles?: GroupRole[];
    targetUserId?: number;
    cause?: unknown;
  }) {
    super('GroupActionForbiddenError', {
      // 動態產生代碼，例如: FORBIDDEN_REMOVE_MEMBER
      code: `FORBIDDEN_${opts.action.toUpperCase()}`,
      message: `You are not authorized to ${opts.action.replace(/_/g, ' ')}.`,
      data: opts,
      cause: opts.cause,
    });
  }

  static updateRole(
    groupId: number,
    actorId: number,
    role: GroupRole,
    targetId: number,
  ) {
    return new GroupActionForbiddenError({
      groupId,
      actorId,
      actorRole: role,
      targetUserId: targetId,
      action: 'update_member_role',
      allowedRoles: ['OWNER'],
    });
  }

  // 靜態工廠方法：移除成員
  static removeMember(
    groupId: number,
    actorId: number,
    role: GroupRole,
    targetId: number,
    cause?: string,
  ) {
    return new GroupActionForbiddenError({
      groupId,
      actorId,
      actorRole: role,
      targetUserId: targetId,
      action: 'remove_member',
      allowedRoles: ['OWNER', 'ADMIN'],
      cause,
    });
  }

  // 靜態工廠方法：更新任務狀態 (修正你原本回傳錯誤實體的 Bug)
  static updateTaskStatus(groupId: number, actorId: number, role: GroupRole) {
    return new GroupActionForbiddenError({
      groupId,
      actorId,
      actorRole: role,
      action: 'update_task_status',
      allowedRoles: ['OWNER', 'ADMIN'],
    });
  }

  // 靜態工廠方法：邀請成員
  static inviteMember(groupId: number, actorId: number) {
    return new GroupActionForbiddenError({
      groupId,
      actorId,
      action: 'invite_member',
    });
  }
}
