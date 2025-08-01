import { Request } from 'express';

export function setSession(req: Request, type: string, message: string): void {
  req.session.flash = {
    type,
    message,
  };
}
