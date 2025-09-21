import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { flashMessage } from './common/middleware/flash.middleware';
import { UnauthorzedFilter } from './common/filters/unauthorized-redirect.filter';

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
  app.use(cookieParser(config.get('COOKIE_SECRET')));
  app.use(
    session({
      name: 'group_flash_message',
      secret: config.get<string>('SESSION_SECRET')!,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600000 },
    }),
  );

  app.use(flashMessage);
  app.useGlobalFilters(new UnauthorzedFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
