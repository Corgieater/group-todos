import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersModule } from 'src/users/users.module';
import { GroupsPageController } from './groups.page.controller';

@Module({
  imports: [PrismaModule, UsersModule],
  providers: [GroupsService],
  controllers: [GroupsController, GroupsPageController],
  exports: [GroupsService],
})
export class GroupsModule {}
