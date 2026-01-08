import type { Request as ExpressRequest, Response } from 'express';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpStatus, Logger } from '@nestjs/common';
import { setSession } from 'src/common/helpers/flash-helper';
import {
  makeRedirectHandler,
  type Handler,
  type FlashMsg,
  type FieldErrs,
} from '../../types/domain-error-page.types';
import { isDomainError, type DomainError } from 'src/errors/domain-error.base';

const log = new Logger('DomainErrorPageFilter');

/** 將 Error.cause 串成可序列化物件 */
function serializeCause(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  const out: any = { name: cause.name, message: cause.message };
  if ((cause as any).code) out.code = (cause as any).code;
  if ((cause as any).meta) out.meta = (cause as any).meta;
  if ((cause as any).cause) out.cause = serializeCause((cause as any).cause);
  return out;
}

/** 決定日誌等級 */
function pickLogLevel(
  code: string | undefined,
  semanticStatus?: number,
): Level {
  const s = semanticStatus ?? 0;
  if (s >= 500) return 'error';
  const infoStatuses = new Set([400, 401, 404, 409, 422]);
  if (infoStatuses.has(s)) {
    const infoCodes = new Set([
      'INVALID_CREDENTIAL',
      'USER_NOT_FOUND',
      'CREDENTIAL_DUPLICATED',
      'GROUP_MEMBER_NOT_FOUND',
      'GROUP_NOT_FOUND',
    ]);
    if (!code || infoCodes.has(code)) return 'info';
  }
  if (s === 403 || s === 429) return 'warn';
  if (s >= 400) return 'warn';
  return 'info';
}

type Level = 'debug' | 'info' | 'warn' | 'error';

/** 對高頻事件抽樣 */
function shouldLog(code?: string, status?: number): boolean {
  const s = status ?? 0;
  const noisy = new Set(['INVALID_CREDENTIAL', 'USER_NOT_FOUND']);
  if (s === 401 && code && noisy.has(code)) {
    return Math.random() < 0.1;
  }
  return true;
}

export function createDomainErrorPageFilter(
  map: Partial<Record<string, Handler>>,
): ExceptionFilter {
  return {
    catch(e: Error, host: ArgumentsHost) {
      if (!isDomainError(e)) throw e;
      const err = e as DomainError<any>;

      const handler: Handler =
        map[(err as any).code] ??
        makeRedirectHandler('/', { msg: 'Unknown error happens' });

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<ExpressRequest>();
      const res = ctx.getResponse<Response>();

      const semanticStatus =
        handler.kind === 'redirect' ? handler.semanticStatus : handler.status;
      const responseStatus =
        handler.kind === 'redirect'
          ? (handler.httpStatus ?? HttpStatus.SEE_OTHER) // 303
          : (handler.status ?? HttpStatus.BAD_REQUEST); // 400

      // ---- 結構化 log ----
      const payloadForLog = {
        code: (err as any).code,
        message: err.message,
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

      const level = pickLogLevel((err as any).code, semanticStatus);
      if (shouldLog((err as any).code, semanticStatus)) {
        const pretty = JSON.stringify(payloadForLog);
        switch (level) {
          case 'error':
            log.error(pretty);
            break;
          case 'warn':
            log.warn(pretty);
            break;
          case 'info':
            log.log(pretty);
            break;
          default:
            log.debug(pretty);
        }
      }

      // ---- 🚀 關鍵修改：判斷是否為 AJAX 請求 ----
      const isAjax =
        req.xhr ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        req.headers.accept?.includes('json') ||
        req.headers['content-type']?.includes('json');

      if (isAjax) {
        // 🚀 強制回傳 JSON 並結束，不讓它跑後面的 Redirect
        return res.status(semanticStatus || 400).json({
          code: (err as any).code,
          message: err.message,
          action: err.action,
          data: (err as any).data,
        });
      }

      // ---- 以下為原本的 SSR 邏輯 (render 或 redirect) ----
      const form: Record<string, any> = {};
      for (const key of handler.preserve ?? []) {
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) {
          form[key] = (req.body as any)[key];
        }
      }

      const resolveMsg = (msg?: FlashMsg): string =>
        typeof msg === 'function'
          ? msg(err)
          : (msg ?? err.message ?? 'Unknown error');

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
          errors: [{ message, code: (err as any).code }],
          form,
          fieldErrors,
        });
      }

      // redirect 分支
      const h = handler;
      const to = typeof h.to === 'function' ? h.to(req, err) : h.to;
      const message = resolveMsg(h.msg);
      const fieldErrors = resolveFieldErrors(h.fieldErrors);

      setSession(req, h.type ?? 'error', message, { form, fieldErrors });
      return res.status(responseStatus).redirect(to);
    },
  };
}
