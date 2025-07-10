import { Request, Response, NextFunction } from 'express';

export function flashMessage(req: Request, res: Response, next: NextFunction) {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
}
