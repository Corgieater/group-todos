import { Request } from 'express';

export function setSession(
  req: Request,
  type: 'error' | 'success' | 'info' | 'warning',
  message: string,
  extras?: { form?: Record<string, any>; fieldErrors?: Record<string, string> },
) {
  (req.session as any).flash = {
    type,
    message,
    ...(extras?.form ? { form: extras.form } : {}),
    ...(extras?.fieldErrors ? { fieldErrors: extras.fieldErrors } : {}),
  };
}
