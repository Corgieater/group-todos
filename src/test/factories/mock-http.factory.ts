import type { Request, Response } from 'express';
import type session from 'express-session';
import type { ArgumentsHost } from '@nestjs/common';
type AnyRec = Record<string, any>;

export function createMockReq(): Request;

export function createMockReq(overrides: Partial<Request>): Request;

export function createMockReq<TUser extends object>(
  overrides: Partial<Request> & { user: TUser },
): Request & { user: TUser };

export function createMockReq(overrides: Partial<Request> = {}): Request {
  const headers: AnyRec = { ...(overrides as AnyRec).headers };

  const getHeader = (name: string) =>
    headers?.[name.toLowerCase()] ?? undefined;

  const base: Partial<Request> = {
    method: 'POST',
    url: '/test',
    originalUrl: (overrides as AnyRec).url ?? '/test',
    headers,
    get: getHeader,
    header: getHeader,
    body: {},
    query: {},
    params: {},
    cookies: {},
    user: undefined,
    session: {} as session.Session & Partial<session.SessionData>,
    ...overrides,
  };

  return base as Request;
}

export function createMockRes() {
  const res: Partial<Response> & {
    status: jest.Mock;
    render: jest.Mock;
    redirect: jest.Mock;
    json: jest.Mock;
    locals: Record<string, any>;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  } = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
    locals: {},
    status: jest.fn().mockReturnThis(),
    render: jest.fn(), // (view, model)
    redirect: jest.fn(), // (url) or (status, url)
    json: jest.fn(), // (payload)
  };
  return res as Response & {
    status: jest.Mock;
    render: jest.Mock;
    redirect: jest.Mock;
    json: jest.Mock;
    locals: Record<string, any>;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

export function createMockHost(req: Request, res: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => undefined,
    }),
    getType: () => 'http',
    // not used by our filter:
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getArgByIndex: () => undefined as any,
    getArgs: () => [] as any,
  } as ArgumentsHost;
}
