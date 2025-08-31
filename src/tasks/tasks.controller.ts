import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { TasksAddDto } from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import { TasksAddPayload } from './types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';

@Controller('api/tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @UseGuards(AccessTokenGuard)
  @Post()
  async addTask(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: TasksAddDto,
    @Res() res: Response,
  ) {
    const payload: TasksAddPayload = {
      title: dto.title,
      status: dto.status ?? null,
      priority: dto.priority ?? null,
      description: dto.description ?? null,
      dueAt: dto.dueAt ?? null,
      location: dto.location ?? null,
      userId: user.userId,
    };
    await this.tasksService.addTask(payload);
    setSession(req, 'success', 'Task added');
    return res.redirect('/');
  }
}
