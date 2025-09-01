import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { Response } from 'express';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksPageController {
  constructor(private tasksService: TasksService) {}
  @UseGuards(AccessTokenGuard)
  @Get('home')
  async home(@CurrentUserDecorator() user: CurrentUser, @Res() res: Response) {
    const tasks = await this.tasksService.getAllTasks(user.userId);
    return res.render('tasks/home', { name: user.userName, tasks });
  }
}
