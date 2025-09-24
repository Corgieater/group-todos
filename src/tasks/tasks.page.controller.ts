import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { Request, Response } from 'express';
import { TasksService } from './tasks.service';
import { TaskStatus } from './types/enum';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { buildTaskVM, toCapital } from 'src/common/helpers/util';

@Controller('tasks')
@UseGuards(AccessTokenGuard)
@UseFilters(TasksPageFilter)
export class TasksPageController {
  constructor(private tasksService: TasksService) {}

  @Get('home')
  async home(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const [todayUndatedTasksRaw, expiredTasksRaw] = await Promise.all([
      this.tasksService.getUnfinishedTasksTodayOrNoDueDate(user.userId),
      this.tasksService.getExpiredTasks(user.userId),
    ]);

    const todayUndatedTasks = todayUndatedTasksRaw.map((t) =>
      buildTaskVM(t, user.timeZone),
    );
    const expiredTasks = expiredTasksRaw.map((t) =>
      buildTaskVM(t, user.timeZone),
    );

    return res.render('tasks/home', {
      name: user.userName,
      expiredTasks,
      todayUndatedTasks,
      totalTasks: todayUndatedTasks.length + expiredTasks.length,
    });
  }

  @Get('create')
  async create(@Res() res: Response) {
    res.render('tasks/create-task');
  }

  // TODO: NOTE:
  // I think this page need a pagination
  @Get('status/:status')
  async listByStatus(
    @Param('status', new ParseEnumPipe(TaskStatus)) status: TaskStatus,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const tasks = await this.tasksService.getTasksByStatus(user.userId, status);
    const viewModel = tasks.map((t) => buildTaskVM(t, user.timeZone));
    const totalTasks = tasks.length;

    return res.render('tasks/list-by-status', {
      totalTasks,
      status: toCapital(status),
      viewModel,
    });
  }

  // TODO: NOTE:
  // I think this page need a pagination
  @Get('list/future')
  async listFuture(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const tasks = await this.tasksService.getAllFutureTasks(
      user.userId,
      user.timeZone,
    );
    const viewModel = tasks.map((t) => buildTaskVM(t, user.timeZone));
    const totalTasks = tasks.length;
    return res.render('tasks/list-by-status', {
      totalTasks,
      status: 'Future',
      viewModel,
    });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const task = await this.tasksService.getTaskById(id, user.userId);
    const viewModel = buildTaskVM(task, user.timeZone);
    res.render('tasks/details', viewModel);
  }

  @Get(':id/edit')
  async edit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const task = await this.tasksService.getTaskById(id, user.userId);
    const viewModel = buildTaskVM(task, user.timeZone);

    res.render('tasks/details-edit', {
      ...viewModel,
      todayISO: new Date().toISOString().slice(0, 10),
    });
  }
}
