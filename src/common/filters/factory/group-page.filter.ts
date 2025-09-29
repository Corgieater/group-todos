import { makeRedirectHandler } from 'src/common/types/domain-error-page.types';
import { createDomainErrorPageFilter } from './create-domain-error-page-filter';

export const GroupsPageFilter = createDomainErrorPageFilter({
  GROUP_NOT_FOUND: makeRedirectHandler('/users-home'),

  ALREADY_MEMBER_ERROR: makeRedirectHandler(
    // 動態 URL：導回該群組 invite 頁
    (_req, err: any) => `/groups/${err?.data?.groupId}`,
    // msg 不給 → 預設用 DomainError.message
    undefined,
    {
      type: 'error',
      preserve: ['email'], // 表單預填
    },
  ),
});
