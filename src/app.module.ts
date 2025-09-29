import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { MailService } from './mail/mail.service';
import { MailModule } from './mail/mail.module';
import { TasksModule } from './tasks/tasks.module';
import { GroupsModule } from './groups/groups.module';
import { PagesModule } from './pages/pages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'prod' ? '.env.prod' : '.env',
    }),
    UsersModule,
    PrismaModule,
    AuthModule,
    MailModule,
    TasksModule,
    GroupsModule,
    PagesModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, MailService],
})
export class AppModule {}
