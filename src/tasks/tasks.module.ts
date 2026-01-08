import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { TasksPageController } from './tasks.page.controller';
import { MailModule } from 'src/mail/mail.module';
import { ConfigModule } from '@nestjs/config';
import { SecurityModule } from 'src/security/security.module';
import { TasksGateWay } from './tasks.gateway';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    MailModule,
    ConfigModule.forRoot(),
    SecurityModule,
  ],
  providers: [TasksService, TasksGateWay],
  controllers: [TasksController, TasksPageController],
  exports: [TasksService, TasksGateWay],
})
export class TasksModule {}
