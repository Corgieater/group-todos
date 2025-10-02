import { makeRedirectHandler } from 'src/common/types/domain-error-page.types';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { HttpStatus } from '@nestjs/common';

import type { DomainError } from 'src/errors/domain-error.base';
import { globalDomainErrorMap } from './common-domain-error-map';

type GroupContext = { groupId: number; targetId?: number };

export function hasGroupContext(
  err: DomainError,
): err is DomainError<GroupContext> {
  const d = (err as any).data;
  return !!d && typeof d.groupId === 'number';
}

export const GroupsPageFilter = createDomainErrorPageFilter({
  ...globalDomainErrorMap,
  GROUP_NOT_FOUND: makeRedirectHandler('/users-home', {
    semanticStatus: HttpStatus.NOT_FOUND,
    msg: () => 'Group not found',
  }),

  ALREADY_MEMBER_ERROR: makeRedirectHandler(
    (req, err: any) => {
      const id = err?.data?.groupId ?? req.params?.id;
      return `/groups/${id}`;
    },
    {
      semanticStatus: HttpStatus.BAD_REQUEST,
      msg: () => 'Member has already in group.',
    },
  ),

  NOT_AUTHORIZED_TO_REMOVE_MEMBER: makeRedirectHandler('/users-home'),
  GROUP_MEMBER_NOT_FOUND: makeRedirectHandler(
    (req, err) => {
      const id = hasGroupContext(err)
        ? err.data?.groupId
        : Number(req.params?.id);
      return `/groups/${id}`;
    },
    {
      semanticStatus: HttpStatus.NOT_FOUND,
      msg: () => 'Group member not found.',
    },
  ),
});
