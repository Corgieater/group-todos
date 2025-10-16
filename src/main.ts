// main.ts
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { doubleCsrf } from 'csrf-csrf';
import { join } from 'path';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { flashMessage } from './common/middleware/flash.middleware';
import { UnauthorzedFilter } from './common/filters/unauthorized-redirect.filter';

const allowBypass = process.env.ALLOW_DEV_CSRF_BYPASS === '1';

const { doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  // TODO:
  // find a way to deal with this
  // see hackmd CSRF TODO
  getSessionIdentifier: () => 'global', // ★ 穩定常數，避免 GET/POST 不一致
  cookieName: 'XSRF-TOKEN',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
  getCsrfTokenFromRequest: (req) =>
    req.body?._csrf ||
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    req.query?._csrf,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('pug');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.use(
    session({
      name: 'group_flash_message',
      secret: config.getOrThrow<string>('SESSION_SECRET'),
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600000 },
    }),
  );
  app.use(cookieParser());

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use((req, res, next) => {
    if (
      allowBypass &&
      req.headers['x-csrf-bypass'] === process.env.BYPASS_CODE && // manual test bypass
      process.env.NODE_ENV !== 'production'
    ) {
      return next(); // skip CSRF
    }
    return doubleCsrfProtection(req, res, next);
  });

  app.use((req: any, _res, next) => {
    if (req.body && typeof req.body === 'object' && '_csrf' in req.body) {
      delete req.body._csrf;
    }
    next();
  });

  app.use((req: any, res: any, next) => {
    try {
      res.locals.csrfToken = req.csrfToken();
    } catch {}
    next();
  });

  // CSRF 錯誤處理
  app.use((err: any, req: any, res: any, next: any) => {
    if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN') {
      return res.status(HttpStatus.FORBIDDEN).send('Invalid CSRF token');
    }
    next(err);
  });

  app.use(flashMessage);
  app.useGlobalFilters(new UnauthorzedFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
