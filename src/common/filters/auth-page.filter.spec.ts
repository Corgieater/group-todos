// filters/auth-page.filter.spec.ts
import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from 'src/common/types/domain-error-page.types';
import {
  createMockReq,
  createMockRes,
  createMockHost,
} from 'src/test/factories/mock-http.factory';
import { AuthErrors } from 'src/errors';
import { dataAs } from 'src/errors/utils/error-data';
import { CredentialDuplicatedData } from 'src/errors/auth';

jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';

const AuthPageFilter = createDomainErrorPageFilter({
  PASSWORD_REUSE: makeRedirectHandler('/auth/reset-password', {
    semanticStatus: HttpStatus.BAD_REQUEST,
    msg: () => 'Please use a new password.',
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
    msg: () => 'Email already in use.',
    fieldErrors: (err) => {
      const d = dataAs<CredentialDuplicatedData>(err);
      return d?.field === 'email'
        ? { email: 'Email already in use.' }
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
});

describe('Auth page filter mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('INVALID_CREDENTIAL → flash + redirect /auth/signin', () => {
    const req = createMockReq({ body: { email: 'x@y.com' } });
    const res = createMockRes();
    const host = createMockHost(req, res);

    AuthPageFilter.catch(AuthErrors.InvalidCredentialError.password(), host);

    expect(setSession).toHaveBeenCalledWith(
      req,
      'error',
      'Invalid email or password',
      { form: {}, fieldErrors: undefined },
    );
    expect(res.redirect).toHaveBeenCalledWith('/auth/signin');
  });

  it('CREDENTIAL_DUPLICATED → preserves fields & fieldErrors', () => {
    const req = createMockReq({ body: { email: 'x@y.com', name: 'x' } });
    const res = createMockRes();
    const host = createMockHost(req, res);

    AuthPageFilter.catch(
      AuthErrors.CredentialDuplicatedError.email('x@y.com'),
      host,
    );

    expect(setSession).toHaveBeenCalledWith(
      req,
      'error',
      'Email already in use.',
      {
        form: { email: 'x@y.com', name: 'x' },
        fieldErrors: { email: 'Email already in use.' },
      },
    );
    expect(res.redirect).toHaveBeenCalledWith('/auth/signup');
  });
});
