import 'express-session';

declare module 'express-session' {
  interface SessionData {
    flash?: {
      type: string;
      message?: string;
    };
  }
}
