import express from 'express';
import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { doubleCsrf } from 'csrf-csrf';
import { join } from 'path';
import {
  BadRequestException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { flashMessage } from './common/middleware/flash.middleware';
import { UnauthorzedFilter } from './common/filters/unauthorized-redirect.filter';
import { loggerInstance } from './common/logger/logger';
import { AllExceptionsFilter } from './common/filters/all-exception.filter';

const allowBypass = process.env.ALLOW_DEV_CSRF_BYPASS === '1';

const { doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  getSessionIdentifier: () => 'global',
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger({
      instance: loggerInstance,
    }),
  });

  const config = app.get(ConfigService);

  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/' });
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('pug');

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const messages = errors.map((err) => {
          // 🚀 使用 Object.values 之前，先確保 constraints 存在，否則給個預設值
          return err.constraints
            ? Object.values(err.constraints).join(', ')
            : 'Validation error';
        });
        return new BadRequestException(messages);
      },
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
      req.headers['x-csrf-bypass'] === process.env.BYPASS_CODE &&
      process.env.NODE_ENV !== 'production'
    ) {
      return next();
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
