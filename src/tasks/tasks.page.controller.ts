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
    const { items, bounds } =
      await this.tasksService.listOpenTasksDueTodayNoneOrExpired(user.userId);
    const tasks = items;
    const { startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc } = bounds;

    type TaskVM = (typeof tasks)[number];
    type Buckets = { expired: TaskVM[]; today: TaskVM[]; none: TaskVM[] };
    const buckets: Buckets = { expired: [], today: [], none: [] };

    for (const t of tasks) {
      const isExpired =
        (t.dueAtUtc && t.dueAtUtc < startOfTodayUtc) ||
        (t.allDayLocalDate && t.allDayLocalDate < todayDateOnlyUtc);

      if (isExpired) {
        buckets.expired.push(t);
        continue;
      }

      const isToday =
        (t.dueAtUtc && t.dueAtUtc >= startUtc && t.dueAtUtc <= endUtc) ||
        (t.allDayLocalDate && +t.allDayLocalDate === +todayDateOnlyUtc);

      if (isToday) {
        buckets.today.push(t);
        continue;
      }

      const isNone = !t.dueAtUtc && !t.allDayLocalDate;
      if (isNone) {
        buckets.none.push(t);
        continue;
      }
    }

    const ts = (d: Date | null | undefined) =>
      d ? d.getTime() : Number.POSITIVE_INFINITY;

    const sortByDay = (a: TaskVM, b: TaskVM) =>
      Number(b.allDay) - Number(a.allDay) ||
      ts(a.allDayLocalDate) - ts(b.allDayLocalDate) ||
      ts(a.dueAtUtc) - ts(b.dueAtUtc);

    const sortByNone = (a: TaskVM, b: TaskVM) =>
      ts(a.createdAt) - ts(b.createdAt);

    buckets.today.sort(sortByDay);
    buckets.expired.sort(sortByDay);
    buckets.none.sort(sortByNone);

    return res.render('tasks/home', {
      name: user.userName,
      today: buckets.today,
      expired: buckets.expired,
      none: buckets.none,
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
