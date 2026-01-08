import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { GroupsPageController } from './groups.page.controller';
import { MailModule } from 'src/mail/mail.module';
import { TasksModule } from 'src/tasks/tasks.module';
import { SecurityModule } from 'src/security/security.module';

@Module({
  imports: [PrismaModule, UsersModule, SecurityModule, MailModule, TasksModule],
  providers: [GroupsService],
  controllers: [GroupsController, GroupsPageController],
  exports: [GroupsService],
})
export class GroupsModule {}
