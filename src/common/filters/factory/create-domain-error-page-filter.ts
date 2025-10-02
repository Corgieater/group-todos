// create-domain-error-page-filter.ts
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

/** 將 Error.cause 串成可序列化物件（避免循環 & 過長輸出） */
function serializeCause(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  const out: any = { name: cause.name, message: cause.message };
  if ((cause as any).code) out.code = (cause as any).code; // e.g. Prisma P2025
  if ((cause as any).meta) out.meta = (cause as any).meta; // e.g. Prisma meta
  if ((cause as any).cause) out.cause = serializeCause((cause as any).cause);
  // 需要時再打開：out.stack = cause.stack;
  return out;
}

/** 決定日誌等級，避免所有 4xx 都是 warn 把頻道洗爆 */
type Level = 'debug' | 'info' | 'warn' | 'error';
function pickLogLevel(
  code: string | undefined,
  semanticStatus?: number,
): Level {
  const s = semanticStatus ?? 0;

  if (s >= 500) return 'error';

  // 可預期使用者錯誤 → info
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

  // 403/429 或其他需要注意的 4xx → warn
  if (s === 403 || s === 429) return 'warn';
  if (s >= 400) return 'warn';

  return 'info';
}

/** 對高頻事件抽樣（避免洗版）；必要時可關掉或調整 */
function shouldLog(code?: string, status?: number): boolean {
  const s = status ?? 0;
  // 登入錯誤 & 帳號不存在：很常見 → 抽樣 10%
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

      // 找對應 handler；fallback：redirect 到首頁＋簡單訊息
      const handler: Handler =
        map[(err as any).code] ??
        makeRedirectHandler('/', { msg: 'Unknown error happens' });

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<ExpressRequest>();
      const res = ctx.getResponse<Response>();

      // ---- 統一計算 semanticStatus（語義用）與 responseStatus（實際回傳） ----
      const semanticStatus =
        handler.kind === 'redirect' ? handler.semanticStatus : handler.status;
      const responseStatus =
        handler.kind === 'redirect'
          ? (handler.httpStatus ?? HttpStatus.SEE_OTHER) // 303
          : (handler.status ?? HttpStatus.BAD_REQUEST); // 400

      // ---- 結構化 log（有抽樣與分級）----
      const payloadForLog = {
        code: (err as any).code,
        message: err.message,
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
            log.log(pretty); // Nest 的 info 等級用 log()
            break;
          default:
            log.debug(pretty);
        }
      }

      // 可選：把錯誤代碼/語義狀態回在 Header（僅這次回應；方便邊界設備/代理串查）
      if ((err as any).code)
        res.setHeader('X-Error-Code', String((err as any).code));
      if (semanticStatus)
        res.setHeader('X-Error-Status', String(semanticStatus));

      // ---- preserve：回填 form 欄位 ----
      const form: Record<string, any> = {};
      for (const key of handler.preserve ?? []) {
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) {
          form[key] = (req.body as any)[key];
        }
      }

      // ---- helpers：把可能是函式的 msg / fieldErrors 解值 ----
      const resolveMsg = (msg?: FlashMsg): string =>
        typeof msg === 'function'
          ? msg(err)
          : (msg ?? err.message ?? 'Unknown error');

      const resolveFieldErrors = (
        fe?: FieldErrs,
      ): Record<string, string> | undefined =>
        typeof fe === 'function' ? fe(err) : fe;

      // ---- 分支：render or redirect ----
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
