// domain-error-page.type.ts
import { HttpStatus } from '@nestjs/common';
import type { DomainError } from 'src/errors/domain-error.base';
import type { Request as ExpressRequest } from 'express';

export type FlashType = 'error' | 'success' | 'warning' | 'info';

export type RedirectTo =
  | string
  | ((req: ExpressRequest, err: DomainError) => string);

export type FlashMsg = string | ((err: DomainError) => string);

export type FieldErrs =
  | Record<string, string>
  | ((err: DomainError) => Record<string, string> | undefined);

// 共同屬性（不包含 status；status 交由各分支自己定義）
export type CommonHandlerProps = {
  msg?: FlashMsg;
  type?: FlashType;
  fieldErrors?: FieldErrs;
  preserve?: string[];
};

// 🔹 兩個具名分支
export type RedirectHandler = CommonHandlerProps & {
  kind: 'redirect';
  to: RedirectTo;
  /** 實際回給瀏覽器的 3xx（預設 303） */
  httpStatus?: number;
  /** 語義上的 4xx/5xx，僅供 log/metrics（不回給瀏覽器） */
  semanticStatus?: number;
};

export type RenderHandler = CommonHandlerProps & {
  kind: 'render';
  view: string;
  /** 真正回給瀏覽器的狀態碼（預設 400） */
  status?: number;
};

export type Handler = RedirectHandler | RenderHandler;

// ---------- Factories ----------

type RedirectOpts = Omit<RedirectHandler, 'kind' | 'to'>;
export function makeRedirectHandler(
  to: RedirectTo,
  opts: RedirectOpts = {},
): RedirectHandler {
  return {
    kind: 'redirect',
    to,
    msg: opts.msg,
    type: opts.type ?? 'error',
    fieldErrors: opts.fieldErrors,
    preserve: opts.preserve,
    httpStatus: opts.httpStatus ?? HttpStatus.SEE_OTHER, // 303
    semanticStatus: opts.semanticStatus, // 可選；log 用
  };
}

type RenderOpts = Omit<RenderHandler, 'kind' | 'view'>;
export function makeRenderHandler(
  view: string,
  opts: RenderOpts = {},
): RenderHandler {
  return {
    kind: 'render',
    view,
    msg: opts.msg,
    type: opts.type ?? 'error',
    fieldErrors: opts.fieldErrors,
    preserve: opts.preserve,
    status: opts.status ?? HttpStatus.BAD_REQUEST, // 400
  };
}
