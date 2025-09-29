import { Module } from '@nestjs/common';
import { UsersHomeController } from './users-home.controller';
import { UsersModule } from 'src/users/users.module';
import { GroupsModule } from 'src/groups/groups.module';

@Module({
  imports: [UsersModule, GroupsModule],
  controllers: [UsersHomeController],
})
export class PagesModule {}
