import { Module } from '@nestjs/common';
import { UsersHomeController } from './users-home.controller';

@Module({
  controllers: [UsersHomeController],
})
export class PagesModule {}
