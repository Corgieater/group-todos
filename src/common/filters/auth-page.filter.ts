import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';
import { HttpStatus } from '@nestjs/common';
import { CredentialDuplicatedData } from 'src/errors/auth';
import { dataAs } from 'src/errors/utils/error-data';

export const AuthPageFilter = createDomainErrorPageFilter({
  PASSWORD_REUSE: makeRedirectHandler('/auth/reset-password', {
    semanticStatus: HttpStatus.BAD_REQUEST,
    msg: () => 'Please use new password.',
  }),

  PASSWORD_CONFIRMATION_MISMATCH: makeRedirectHandler('/auth/reset-password', {
    semanticStatus: HttpStatus.BAD_REQUEST,
    msg: () => 'New password and confirmation do not match.',
  }),

  INVALID_TOKEN: makeRedirectHandler('/', {
    semanticStatus: HttpStatus.UNAUTHORIZED,
    msg: () => 'Invalid token',
  }),

  CREDENTIAL_DUPLICATED: makeRedirectHandler('/auth/signup', {
    semanticStatus: HttpStatus.CONFLICT,
    msg: () => 'Credential already taken.',
    fieldErrors: (err) => {
      const d = dataAs<CredentialDuplicatedData>(err);
      return d?.field === 'email'
        ? { email: 'Email already taken.' }
        : undefined;
    },
    preserve: ['email', 'name'],
  }),

  INVALID_CREDENTIAL: makeRedirectHandler('/auth/signin', {
    semanticStatus: HttpStatus.UNAUTHORIZED,
    msg: () => 'Invalid email or password',
  }),

  INVALID_OLD_PASSWORD: makeRedirectHandler('/users-home', {
    semanticStatus: HttpStatus.UNAUTHORIZED,
    msg: () => 'Invalid old password',
  }),

  USER_NOT_FOUND: makeRedirectHandler('/auth/signin', {
    semanticStatus: HttpStatus.NOT_FOUND,
    msg: () => 'User not found.',
  }),
});
