import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';

export const AuthPageFilter = createDomainErrorPageFilter({
  PASSWORD_REUSE: makeRedirectHandler(
    '/auth/reset-password',
    'Please use a new password.',
    {
      status: HttpStatus.BAD_REQUEST,
    },
  ),

  PASSWORD_CONFIRMATION_MISMATCH: makeRedirectHandler(
    '/auth/reset-password',
    'Password confirmation does not match.',
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
  ),

  INVALID_TOKEN: makeRedirectHandler(
    '/',
    'Reset link is invalid or expired. Please get a new one.',
    {
      status: HttpStatus.FORBIDDEN,
    },
  ),

  CREDENTIAL_DUPLICATED: makeRedirectHandler(
    '/auth/signup',
    'Email already taken.',
    {
      status: HttpStatus.CONFLICT,
      preserve: ['email', 'name'],
      fieldErrors: { email: 'Already registered.' },
    },
  ),

  INVALID_CREDENTIAL: makeRedirectHandler(
    '/auth/signin',
    'Invalid credential',
    {
      status: HttpStatus.FORBIDDEN,
    },
  ),

  INVALID_OLD_PASSWORD: makeRedirectHandler(
    '/users/home',
    'Old password invalid',
    {
      status: HttpStatus.FORBIDDEN,
    },
  ),

  USER_NOT_FOUND: makeRedirectHandler('/auth/signin', 'Invalid credential', {
    status: HttpStatus.FORBIDDEN,
  }),
});
