import type { Request as ExpressRequest, Response } from 'express';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { setSession } from 'src/common/helpers/flash-helper';
import {
  makeRedirectHandler,
  type Handler,
  type FlashMsg,
  type FieldErrs,
} from '../../types/domain-error-page.types';
import { isDomainError } from 'src/errors/domain-error.base';

export function createDomainErrorPageFilter(
  map: Partial<Record<string, Handler>>,
): ExceptionFilter {
  return {
    catch(e: Error, host: ArgumentsHost) {
      if (!isDomainError(e)) throw e;

      const handler =
        map[(e as any).code] ??
        makeRedirectHandler('/', 'Unknown error happens');

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<ExpressRequest>();
      const res = ctx.getResponse<Response>();

      // 回填 form
      const form: Record<string, any> = {};
      for (const key of handler.preserve ?? []) {
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) {
          form[key] = (req.body as any)[key];
        }
      }

      // 解值 helpers
      const resolveMsg = (msg?: FlashMsg): string =>
        typeof msg === 'function'
          ? msg(e as any)
          : (msg ?? (e as any).message ?? 'Unknown error');

      const resolveFieldErrors = (
        fe?: FieldErrs,
      ): Record<string, string> | undefined =>
        typeof fe === 'function' ? fe(e as any) : fe;

      if (handler.kind === 'render') {
        // 🔸 這裡用局部變數 h，TS 縮小成 RenderHandler
        const h = handler;
        const message = resolveMsg(h.msg);
        const fieldErrors = resolveFieldErrors(h.fieldErrors);
        return res.status(h.status ?? 400).render(h.view, {
          errors: [{ message, code: (e as any).code }], // 建議用 message 欄位
          form,
          fieldErrors,
        });
      }

      // 🔹 redirect 分支
      const h = handler; // 縮小成 RedirectHandler
      const to = typeof h.to === 'function' ? h.to(req, e as any) : h.to;
      const message = resolveMsg(h.msg);
      const fieldErrors = resolveFieldErrors(h.fieldErrors);

      setSession(req, h.type ?? 'error', message, { form, fieldErrors });
      return res.status(h.status ?? 303).redirect(to);
    },
  };
}
