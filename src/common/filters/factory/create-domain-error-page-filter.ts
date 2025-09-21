import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { setSession } from '../../helpers/flash-helper';
import type { Handler } from '../../types/domain-error-page.types';
import { isDomainError } from 'src/errors/domain-error.base';
import { makeRedirectHandler } from '../../types/domain-error-page.types';

export function createDomainErrorPageFilter(
  map: Partial<Record<string, Handler>>,
): ExceptionFilter {
  return {
    catch(e: Error, host: ArgumentsHost) {
      if (!isDomainError(e)) throw e;

      const handler =
        map[e.code] ?? makeRedirectHandler('/', 'Unknown error happens');
      if (!handler) throw e;

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<Request>();
      const res = ctx.getResponse<Response>();

      const form: Record<string, any> = {};
      for (const key of handler.preserve ?? []) {
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) {
          form[key] = req.body[key];
        }
      }

      if (handler.kind === 'render') {
        return res.status(handler.status!).render(handler.view, {
          errors: [{ message: handler.msg, code: e.code }],
          form,
          fieldErrors: handler.fieldErrors,
        });
      }

      setSession(req, handler.type ?? 'error', handler.msg, {
        form,
        fieldErrors: handler.fieldErrors,
      });
      return res.redirect(handler.to);
    },
  };
}
