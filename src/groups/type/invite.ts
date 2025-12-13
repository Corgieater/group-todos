import type { ActionTokenType } from 'src/generated/prisma/client';
import { AuthErrors } from 'src/errors';

type InviteTokenRow = {
  id: number;
  type: 'GROUP_INVITE';
  tokenHash: string;
  userId: number;
  groupId: number;
};

export function assertInviteRow(row: {
  type: ActionTokenType;
  userId: number | null;
  groupId: number | null;
}): asserts row is InviteTokenRow {
  if (
    row.type !== 'GROUP_INVITE' ||
    row.userId == null ||
    row.groupId == null
  ) {
    throw AuthErrors.InvalidTokenError.invite();
  }
}
