import { DomainError } from '../domain-error.base';

// TODO: NOTE:
// It looks like my other error should should have format like this
// or i can not log out correct id, if we can not tell which parameter belongs to which value, it useless

// we need stuff like this!
/**
 * {
  "err": {
    "name": "GroupMemberNotFoundError",
    "code": "GROUP_MEMBER_NOT_FOUND",
    "message": "Member 1 is not in group 1.",
    "data": { "targetId": 1, "groupId": 1 }
  }
}
 */

// Question: sould I do something with 'cause'?

export class GroupMemberNotFoundError extends DomainError<{
  targetId: number;
  groupId: number;
}> {
  readonly targetId: number;
  readonly groupId: number;

  constructor(targetId: number, groupId: number, opts?: { cause?: unknown }) {
    super('GroupMemberNotFoundError', {
      code: 'GROUP_MEMBER_NOT_FOUND',
      message: 'Member is not in the group.',
      data: { targetId, groupId },
      cause: opts?.cause,
    });
    this.targetId = targetId;
    this.groupId = groupId;
  }

  static byId(targetId: number, groupId: number, opts?: { cause?: unknown }) {
    return new GroupMemberNotFoundError(targetId, groupId, opts);
  }
}

export class GroupNotFoundError extends DomainError {
  readonly actorId: number;
  readonly groupId: number;

  constructor(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    super('GroupNotFoundError', {
      code: 'GROUP_NOT_FOUND',
      message: 'Group was not found',
      data: { actorId, groupId },
      cause: opts?.cause,
    });
    this.actorId = actorId;
    this.groupId = groupId;
  }

  static byId(actorId: number, groupId: number, opts?: { cause?: unknown }) {
    return new GroupNotFoundError(actorId, groupId, opts);
  }
}
