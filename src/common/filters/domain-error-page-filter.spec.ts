import { HttpStatus } from '@nestjs/common';
import {
  createMockReq,
  createMockRes,
  createMockHost,
} from 'src/test/factories/mock-http.factory';

import { makeDomainErrorPageFilterByCode } from './domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';
import { AuthErrors } from 'src/errors';

jest.mock('../helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from '../helpers/flash-helper';
import { Response } from 'express';

describe('domain page filter', () => {
  let filter;
  let res: Response;
  beforeEach(() => {
    jest.clearAllMocks();
    res = createMockRes();
    filter = makeDomainErrorPageFilterByCode({
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

      USER_NOT_FOUND: makeRedirectHandler(
        '/auth/signin',
        'Invalid credential',
        {
          status: HttpStatus.FORBIDDEN,
        },
      ),
    });
  });

  it('redirect with flash', () => {
    const req = createMockReq({
      body: { email: 'test@test.com', password: 'test' },
    });
    const host = createMockHost(req, res);
    filter.catch(AuthErrors.InvalidCredentialError.password(), host);
    expect(setSession).toHaveBeenCalledWith(
      req,
      'error',
      'Invalid credential',
      { form: {}, fieldErrors: undefined },
    );
    expect(res.redirect).toHaveBeenCalledWith('/auth/signin');
  });

  it('should redirect and set form and filedErrors', () => {
    const req = createMockReq({
      body: { email: 'test@test.com', name: 'test', password: 'test' },
    });
    const host = createMockHost(req, res);
    filter.catch(new AuthErrors.CredentialDuplicatedError(), host);
    expect(setSession).toHaveBeenCalledWith(
      req,
      'error',
      'Email already taken.',
      {
        form: { email: 'test@test.com', name: 'test' },
        fieldErrors: { email: 'Already registered.' },
      },
    );
    expect(res.redirect).toHaveBeenCalledWith('/auth/signup');
  });

  it('falls back to default redirect when code not mapped', () => {
    // intentionally cover the whole filter
    filter = makeDomainErrorPageFilterByCode({
      PASSWORD_REUSE: makeRedirectHandler(
        '/auth/reset-password',
        'Please use a new password.',
      ),
    });
    const req = createMockReq({
      body: { email: 'test@test.com', password: 'test' },
    });
    const host = createMockHost(req, res);
    filter.catch(AuthErrors.InvalidCredentialError.password(), host);
    expect(setSession).toHaveBeenCalledWith(
      req,
      'error',
      'Unknown error happens',
      {
        form: {},
        fieldErrors: undefined,
      },
    );
    expect(res.redirect).toHaveBeenCalledWith('/');
  });
});
