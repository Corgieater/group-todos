import { makeRedirectHandler } from 'src/common/types/domain-error-page.types';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';

export const GroupsPageFilter = createDomainErrorPageFilter({
  GROUP_NOT_FOUND: makeRedirectHandler('/users-home'),

  ALREADY_MEMBER_ERROR: makeRedirectHandler(
    (req, err: any) => {
      const id = err?.data?.groupId ?? req.params?.id;
      return `/groups/${id}`;
    },
    (err) => err.message,
    {
      type: 'error',
      preserve: ['email'],
    },
  ),
});
