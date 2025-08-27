import { HttpStatus } from '@nestjs/common';

export type FlashType = 'error' | 'success' | 'warning' | 'info';

export type BaseHandler = {
  status?: number; // default varies by helper
  msg: string;
  type?: FlashType; // flash type; default 'error'
  readonly preserve?: string[];
  fieldErrors?: Record<string, string>;
};

//RedirectHandler and RenderHandler are type switching, if typescirpt see type = redirect, it will use redirectHandler based on export type Handler = RedirectHandler | RenderHandler
export type RedirectHandler = BaseHandler & {
  kind: 'redirect';
  to: string;
};

export type RenderHandler = BaseHandler & {
  kind: 'render';
  view: string;
};

export type Handler = RedirectHandler | RenderHandler;

export const makeRedirectHandler = (
  to: string,
  msg: string,
  opts: Partial<Omit<RedirectHandler, 'kind' | 'to' | 'msg'>> = {},
): RedirectHandler => ({
  kind: 'redirect',
  to,
  msg,
  status: HttpStatus.SEE_OTHER, // sensible default for POST-redirect-GET
  type: 'error',
  ...opts,
});

export const makeRenderHandler = (
  view: string,
  msg: string,
  opts: Partial<Omit<RenderHandler, 'kind' | 'view' | 'msg'>> = {},
): RenderHandler => ({
  kind: 'render',
  view,
  msg,
  status: HttpStatus.BAD_REQUEST, // sensible default for form re-render
  type: 'error',
  ...opts,
});
