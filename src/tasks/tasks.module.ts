import { Module } from '@nestjs/common';
import { TasksService } from './services/tasks.service';
import { TasksController } from './controllers/tasks.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { TasksPageController } from './controllers/tasks.page.controller';
import { MailModule } from 'src/mail/mail.module';
import { ConfigModule } from '@nestjs/config';
import { SecurityModule } from 'src/security/security.module';
import { TasksGateWay } from './tasks.gateway';
import { SubTasksService } from './services/sub-tasks.service';
import { TasksHelperService } from './services/helper.service';
import { SubTasksController } from './controllers/sub-tasks.controller';
import { TaskAssignmentManager } from './services/task-assignment.service';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    MailModule,
    ConfigModule.forRoot(),
    SecurityModule,
  ],
  providers: [
    TasksService,
    SubTasksService,
    TasksGateWay,
    TasksHelperService,
    TaskAssignmentManager,
  ],
  controllers: [TasksController, SubTasksController, TasksPageController],
  exports: [TasksService, TasksGateWay],
})
export class TasksModule {}
