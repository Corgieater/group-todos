import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { flashMessage } from './middleware/flash.middleware';
import { RedirectUnauthorizedFilter } from './common/filters/redirect-unauthorized.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser(config.get('COOKIE_SECRET')));
  app.use(
    session({
      secret: config.get('SESSION_SECRET')!,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 60000 },
    }),
  );
  app.use(flashMessage);
  app.useGlobalFilters(new RedirectUnauthorizedFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
