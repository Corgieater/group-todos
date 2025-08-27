import 'express-session';

declare module 'express-session' {
  interface SessionData {
    flash?: {
      type: 'error' | 'success' | 'info' | 'warning';
      message?: string;
      form?: Record<string, any>;
      fieldErrors?: Record<string, string>;
    };
  }
}
