import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsersPageController } from './users.page.controller';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController, UsersPageController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
