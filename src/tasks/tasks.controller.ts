import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
  ParseEnumPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { TasksAddDto, UpdateTaskDto } from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import { TasksAddPayload } from './types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { Status } from '@prisma/client';

@Controller('api/tasks')
@UseFilters(TasksPageFilter)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @UseGuards(AccessTokenGuard)
  @Post()
  async create(
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
      allDay: dto.allDay,
      dueDate: dto.dueDate ?? null,
      dueTime: dto.dueTime ?? null,
      location: dto.location ?? null,
      userId: user.userId,
    };

    await this.tasksService.createTask(payload);
    setSession(req, 'success', 'Task added');
    return res.redirect('/tasks/home');
  }

  // NOTE:
  // Currently allowed empty data update,
  // once frontend been separated, we can check by frontend
  @UseGuards(AccessTokenGuard)
  @Post(':id/update')
  async update(
    @Req() req: Request,
    @Body() dto: UpdateTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const task = await this.tasksService.updateTask(id, user.userId, dto);
    setSession(req, 'success', 'Task has been updated');
    return res.redirect(`/tasks/${task.id}`);
  }

  // NOTE:
  // Maybe there will be more status in the future
  @UseGuards(AccessTokenGuard)
  @Post(':id/update/status')
  async updateStatus(
    @Req() req: Request,
    @Body('status', new ParseEnumPipe(Status)) status: Status,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.updateTaskStatus(id, user.userId, status);
    setSession(req, 'success', 'Status has been changed.');
    return res.redirect('/tasks/home');
  }

  //NOTE:
  // 1. We use pug, so we use Post instead of delete
  // 2. Currently we don't warm user when task deleting .
  // Add this when frontend separated
  @UseGuards(AccessTokenGuard)
  @Post(':id/delete')
  async delete(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.deleteTask(id, user.userId);
    setSession(req, 'success', 'Task has been deleted.');
    return res.redirect('/tasks/home');
  }
}
