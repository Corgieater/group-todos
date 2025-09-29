import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';

export const AuthPageFilter = createDomainErrorPageFilter({
  PASSWORD_REUSE: makeRedirectHandler('/auth/reset-password'),

  PASSWORD_CONFIRMATION_MISMATCH: makeRedirectHandler('/auth/reset-password'),

  INVALID_TOKEN: makeRedirectHandler('/'),

  CREDENTIAL_DUPLICATED: makeRedirectHandler('/auth/signup'),

  INVALID_CREDENTIAL: makeRedirectHandler('/auth/signin'),

  INVALID_OLD_PASSWORD: makeRedirectHandler('/users/home'),

  USER_NOT_FOUND: makeRedirectHandler('/auth/signin'),
});
