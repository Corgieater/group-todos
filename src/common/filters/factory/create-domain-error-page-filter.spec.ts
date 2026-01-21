import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './create-domain-error-page-filter';
import {
  makeRedirectHandler,
  makeRenderHandler,
} from 'src/common/types/domain-error-page.types';
import {
  createMockReq,
  createMockRes,
  createMockHost,
} from 'src/test/factories/mock-http.factory';
import { DomainError } from 'src/errors/domain-error.base';

jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';
import { dataAs } from 'src/errors/utils/error-data';

class DummyError extends DomainError<{ x?: number }> {
  constructor(code: 'PASSWORD_REUSE', msg = 'oops', data?: { x?: number }) {
    super('DummyError', { code, message: msg, data });
  }
}

describe('createDomainErrorPageFilter (factory behavior)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirect: sets flash and 303 redirect', () => {
    // ✅ 用與下面 DummyError 一致的 key：'PASSWORD_REUSE'
    const filter = createDomainErrorPageFilter({
      PASSWORD_REUSE: makeRedirectHandler('/somewhere', {
        semanticStatus: HttpStatus.BAD_REQUEST,
        preserve: ['email'], // ✅ 要回填 email
        // ✅ 用 dataAs 取得強型別 data
        msg: (err) => `hi:${dataAs<{ x?: number }>(err)?.x ?? 'n/a'}`,
      }),
    });

    const req = createMockReq({
      body: { email: 'a@b.com', pwd: 'xxx' },
      method: 'POST',
      url: '/test',
    });
    const res = createMockRes();
    const host = createMockHost(req, res);

    // ✅ code 與 map key 完全一致
    filter.catch(new DummyError('PASSWORD_REUSE', 'ignored', { x: 7 }), host);

    expect(setSession).toHaveBeenCalledWith(req, 'error', 'hi:7', {
      form: { email: 'a@b.com' },
      fieldErrors: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(303);
    expect(res.redirect).toHaveBeenCalledWith('/somewhere');
  });
});
