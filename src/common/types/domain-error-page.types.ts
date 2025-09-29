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

// 共同屬性（不要含 kind）
export type CommonHandlerProps = {
  msg?: FlashMsg;
  type?: FlashType;
  fieldErrors?: FieldErrs;
  preserve?: string[];
  status?: number; // 兩邊都可用，預設值各自給
};

// 🔹 兩個具名的分支（有固定的 discriminant：kind）
export type RedirectHandler = CommonHandlerProps & {
  kind: 'redirect';
  to: RedirectTo;
};

export type RenderHandler = CommonHandlerProps & {
  kind: 'render';
  view: string;
};

export type Handler = RedirectHandler | RenderHandler;

export const makeRedirectHandler = (
  to: RedirectTo,
  msg?: FlashMsg,
  opts: Omit<RedirectHandler, 'kind' | 'to' | 'msg'> = {},
): RedirectHandler => ({
  kind: 'redirect',
  to,
  msg,
  status: opts.status ?? HttpStatus.SEE_OTHER, // 303
  type: opts.type ?? 'error',
  fieldErrors: opts.fieldErrors,
  preserve: opts.preserve,
});

export const makeRenderHandler = (
  view: string,
  msg?: FlashMsg,
  opts: Omit<RenderHandler, 'kind' | 'view' | 'msg'> = {},
): RenderHandler => ({
  kind: 'render',
  view,
  msg,
  status: opts.status ?? HttpStatus.BAD_REQUEST, // 400
  type: opts.type ?? 'error',
  fieldErrors: opts.fieldErrors,
  preserve: opts.preserve,
});
