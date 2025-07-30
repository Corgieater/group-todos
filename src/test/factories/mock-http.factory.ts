import { Request, Response } from 'express';

export function createMockReq(): Request {
  return {
    session: {} as Record<string, any>,
  } as unknown as Request;
}

export function createMockRes(): Response {
  return {
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}
