import type { Request as ExpressRequest, Response } from 'express';
// 🚀 關鍵修改 3：從 main.ts 引入配置好的實例
import { loggerInstance } from 'src/common/logger/logger';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { setSession } from 'src/common/helpers/flash-helper';
import {
  makeRedirectHandler,
  type Handler,
  type FlashMsg,
  type FieldErrs,
} from '../../types/domain-error-page.types';
import { isDomainError, type DomainError } from 'src/errors/domain-error.base';

// ---- Helper 函式 ----

function serializeCause(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  const out: any = { name: cause.name, message: cause.message };
  if ((cause as any).code) out.code = (cause as any).code;
  if ((cause as any).meta) out.meta = (cause as any).meta;
  if ((cause as any).cause) out.cause = serializeCause((cause as any).cause);
  return out;
}

function pickLogLevel(code: string | undefined, semanticStatus?: number) {
  const s = semanticStatus ?? 0;
  if (s >= 500) return 'error';
  const infoStatuses = new Set([400, 401, 404, 409, 422]);
  if (infoStatuses.has(s)) {
    const infoCodes = new Set([
      'INVALID_CREDENTIAL',
      'USER_NOT_FOUND',
      'CREDENTIAL_DUPLICATED',
      'ALREADY_MEMBER',
      'PASSWORD_REUSE',
      'PASSWORD_CONFIRMATION_MISMATCH',
      'GROUP_MEMBER_NOT_FOUND',
      'GROUP_NOT_FOUND',
      'CANNOT_INVITE_SELF',
    ]);
    if (!code || infoCodes.has(code)) return 'info';
  }
  if (s === 403 || s === 429 || s >= 400) return 'warn';
  return 'info';
}

function shouldLog(code?: string, status?: number): boolean {
  const s = status ?? 0;
  if (
    s === 401 &&
    code &&
    new Set(['INVALID_CREDENTIAL', 'USER_NOT_FOUND']).has(code)
  ) {
    return Math.random() < 0.1;
  }
  return true;
}

// ---- Filter 主體 ----

export function createDomainErrorPageFilter(
  map: Partial<Record<string, Handler>>,
): ExceptionFilter {
  return {
    catch(e: Error, host: ArgumentsHost) {
      if (!isDomainError(e)) throw e;
      const err = e as DomainError<any>;
      const errorCode = (err as any).code;

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<ExpressRequest>();
      const res = ctx.getResponse<Response>();

      const handler: Handler =
        map[errorCode] ??
        makeRedirectHandler(req.header('Referer') || '/', {
          msg: err.message,
        });

      const semanticStatus =
        handler.kind === 'redirect' ? handler.semanticStatus : handler.status;
      const responseStatus =
        handler.kind === 'redirect'
          ? (handler.httpStatus ?? HttpStatus.SEE_OTHER)
          : (handler.status ?? HttpStatus.BAD_REQUEST);

      const logContext = {
        code: errorCode,
        action: err.action,
        userId: err.actorId,
        data: (err as any).data,
        semanticStatus,
        responseStatus,
        route: req.originalUrl,
        method: req.method,
        ip: req.ip,
        ua: req.get?.('user-agent'),
        cause: serializeCause((err as any).cause),
      };

      // 🚀 關鍵修改 4：使用確定的實例輸出日誌
      if (shouldLog(errorCode, semanticStatus)) {
        const level = pickLogLevel(errorCode, semanticStatus);

        loggerInstance.log({
          level: level === 'info' ? 'info' : (level as string),
          message: err.message,
          context: 'DomainErrorFilter',
          ...logContext,
          stack: level === 'error' ? err.stack : undefined,
        });
      }

      // ---- 後續 AJAX & SSR 邏輯 (保持不變) ----
      const isAjax =
        req.xhr ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        req.headers.accept?.includes('json') ||
        req.headers['content-type']?.includes('json');
      if (isAjax) {
        return res.status(semanticStatus || 400).json({
          code: errorCode,
          message: err.message,
          action: err.action,
          data: (err as any).data,
        });
      }

      const form: Record<string, any> = {};
      for (const key of handler.preserve ?? []) {
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) {
          form[key] = (req.body as any)[key];
        }
      }
      const resolveMsg = (msg?: FlashMsg): string =>
        typeof msg === 'function'
          ? msg(err)
          : (msg ?? err.message ?? 'Unknown error happens');
      const resolveFieldErrors = (
        fe?: FieldErrs,
      ): Record<string, string> | undefined =>
        typeof fe === 'function' ? fe(err) : fe;

      if (handler.kind === 'render') {
        const h = handler;
        const message = resolveMsg(h.msg);
        const fieldErrors = resolveFieldErrors(h.fieldErrors);
        res.status(responseStatus);
        return res.render(h.view, {
          errors: [{ message, code: errorCode }],
          form,
          fieldErrors,
        });
      }

      const h = handler;
      const to = typeof h.to === 'function' ? h.to(req, err) : h.to;
      const message = resolveMsg(h.msg);
      const fieldErrors = resolveFieldErrors(h.fieldErrors);
      setSession(req, h.type ?? 'error', message, { form, fieldErrors });
      return res.status(responseStatus).redirect(to);
    },
  };
}
