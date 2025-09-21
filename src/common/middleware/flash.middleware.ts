import { Request, Response, NextFunction } from 'express';

export function flashMessage(req: Request, res: Response, next: NextFunction) {
  const msg = (req.session as any).flash;
  if (msg !== undefined) {
    res.locals.flash = msg;
    delete (req.session as any).flash;
  } else {
    res.locals.flash = null;
  }
  next();
}
