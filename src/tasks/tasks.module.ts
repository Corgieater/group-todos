import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { TasksPageController } from './tasks.page.controller';

@Module({
  imports: [PrismaModule, UsersModule],
  providers: [TasksService],
  controllers: [TasksController, TasksPageController],
  exports: [TasksService],
})
export class TasksModule {}
