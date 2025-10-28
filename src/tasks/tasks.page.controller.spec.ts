import { Test, TestingModule } from '@nestjs/testing';
import type { Task as TaskModel, User as UserModel } from '@prisma/client';
import { TaskStatus } from './types/enum';
import { TasksPageController } from './tasks.page.controller';
import { TasksService } from './tasks.service';
import { Request, Response } from 'express';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { createMockTask } from 'src/test/factories/mock-task.factory';
jest.mock('src/common/helpers/util', () => ({
  // keep the real stuff
  ...jest.requireActual('src/common/helpers/util'),
  // override only this
  buildTaskVM: jest.fn((t: any, tz: string) => ({
    ...t,
    mockVm: true,
    mockTz: tz,
  })),
}));
import { buildTaskVM } from 'src/common/helpers/util';

describe('TasksController', () => {
  let tasksPageController: TasksPageController;
  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;
  const lowTask: TaskModel = createMockTask();
  const mediumTask: TaskModel = createMockTask({
    id: 2,
    title: 'medium test',
    priority: 3,
  });
  const urgentTask: TaskModel = createMockTask({
    id: 3,
    title: 'urgent test',
    priority: 1,
  });

  const mockTasksSerivce = {
    create: jest.fn(),
    getTaskById: jest.fn(),
    listOpenTasksDueTodayNoneOrExpired: jest.fn(),
    getTasksByStatus: jest.fn(),
    getAllFutureTasks: jest.fn(),
  };

  beforeAll(async () => {
    user = createMockUser();
    req = createMockReq();
    res = createMockRes();

    currentUser = {
      userId: user.id,
      userName: user.name,
      email: user.email,
      timeZone: user.timeZone,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksPageController],
      providers: [{ provide: TasksService, useValue: mockTasksSerivce }],
    }).compile();

    tasksPageController = module.get<TasksPageController>(TasksPageController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // home
  // ───────────────────────────────────────────────────────────────────────────────

  describe('home', () => {
    const bounds = {
      timeZone: 'Asia/Taipei',
      startUtc: new Date('2025-09-01T00:00:00.000Z'),
      endUtc: new Date('2025-09-01T23:59:59.999Z'),
      startOfTodayUtc: new Date('2025-09-01T00:00:00.000Z'),
      todayDateOnlyUtc: new Date('2025-09-01T00:00:00.000Z'),
    };
    const items = [
      // EXPIRED — all-day（昨天）
      {
        id: 1,
        title: 'Expired all-day',
        status: 'UNFINISHED',
        priority: 3,
        allDay: true,
        allDayLocalDate: new Date('2025-08-31T00:00:00.000Z'),
        dueAtUtc: null,
        createdAt: new Date('2025-08-15T00:00:00.000Z'),
        location: null,
        description: null,
      },
      // EXPIRED — 有時分（昨天晚上）
      {
        id: 2,
        title: 'Expired timed',
        status: 'UNFINISHED',
        priority: 2,
        allDay: false,
        allDayLocalDate: null,
        dueAtUtc: new Date('2025-08-31T18:30:00.000Z'),
        createdAt: new Date('2025-08-10T00:00:00.000Z'),
        location: null,
        description: null,
      },
      // TODAY — all-day（今天）
      {
        id: 3,
        title: 'Today all-day',
        status: 'UNFINISHED',
        priority: 1,
        allDay: true,
        allDayLocalDate: new Date('2025-09-01T00:00:00.000Z'),
        dueAtUtc: null,
        createdAt: new Date('2025-08-20T00:00:00.000Z'),
        location: null,
        description: null,
      },
      // TODAY — 有時分（今天 09:00）
      {
        id: 4,
        title: 'Today 09:00',
        status: 'UNFINISHED',
        priority: 3,
        allDay: false,
        allDayLocalDate: null,
        dueAtUtc: new Date('2025-09-01T09:00:00.000Z'),
        createdAt: new Date('2025-08-21T00:00:00.000Z'),
        location: null,
        description: null,
      },
      // TODAY — 有時分（今天 15:00）
      {
        id: 5,
        title: 'Today 15:00',
        status: 'UNFINISHED',
        priority: 4,
        allDay: false,
        allDayLocalDate: null,
        dueAtUtc: new Date('2025-09-01T15:00:00.000Z'),
        createdAt: new Date('2025-08-22T00:00:00.000Z'),
        location: null,
        description: null,
      },
      // NONE — 無期限
      {
        id: 6,
        title: 'Undated A',
        status: 'UNFINISHED',
        priority: 4,
        allDay: false,
        allDayLocalDate: null,
        dueAtUtc: null,
        createdAt: new Date('2025-08-05T00:00:00.000Z'),
        location: null,
        description: null,
      },
      {
        id: 7,
        title: 'Undated B',
        status: 'UNFINISHED',
        priority: 2,
        allDay: false,
        allDayLocalDate: null,
        dueAtUtc: null,
        createdAt: new Date('2025-08-01T00:00:00.000Z'),
        location: null,
        description: null,
      },
    ];

    beforeEach(() => {
      const now = new Date('2025-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
    });

    it('partitions tasks into expired/today/none and renders view with sorted buckets', async () => {
      mockTasksSerivce.listOpenTasksDueTodayNoneOrExpired.mockResolvedValueOnce(
        { items, bounds },
      );

      await tasksPageController.home(req, currentUser, res);

      expect(
        mockTasksSerivce.listOpenTasksDueTodayNoneOrExpired,
      ).toHaveBeenCalledWith(currentUser.userId);

      expect(
        mockTasksSerivce.listOpenTasksDueTodayNoneOrExpired,
      ).toHaveBeenCalledTimes(1);

      expect(res.render).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];

      expect(view).toBe('tasks/home');
      expect(model).toHaveProperty('name', user.name);
      expect(model).toHaveProperty('today');
      expect(model).toHaveProperty('expired');
      expect(model).toHaveProperty('none');

      const { today, expired, none } = model;
      expect(today.map((t: any) => t.id).sort()).toEqual([3, 4, 5]);
      expect(expired.map((t: any) => t.id).sort()).toEqual([1, 2]);
      expect(none.map((t: any) => t.id).sort()).toEqual([6, 7]);

      expect(today.map((t: any) => t.id)).toEqual([3, 4, 5]);

      expect(expired.map((t: any) => t.id)).toEqual([1, 2]);

      expect(none.map((t: any) => t.id)).toEqual([7, 6]);
    });

    it('should renders with empty arrays', async () => {
      const emptyBounds = {
        timeZone: 'Asia/Taipei',
        startUtc: new Date('2025-09-01T00:00:00.000Z'),
        endUtc: new Date('2025-09-01T23:59:59.999Z'),
        startOfTodayUtc: new Date('2025-09-01T00:00:00.000Z'),
        todayDateOnlyUtc: new Date('2025-09-01T00:00:00.000Z'),
      };

      mockTasksSerivce.listOpenTasksDueTodayNoneOrExpired.mockResolvedValueOnce(
        {
          items: [],
          bounds: emptyBounds,
        },
      );

      await tasksPageController.home(req, currentUser, res);

      expect(res.render).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/home');

      expect(Array.isArray(model.today)).toBe(true);
      expect(Array.isArray(model.expired)).toBe(true);
      expect(Array.isArray(model.none)).toBe(true);

      expect(model.today.length).toBe(0);
      expect(model.expired.length).toBe(0);
      expect(model.none.length).toBe(0);

      expect(model.name).toBe(currentUser.userName);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // listByStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('listByStatus', () => {
    it('should render all finished tasks', async () => {
      mockTasksSerivce.getTasksByStatus.mockResolvedValueOnce([
        lowTask,
        mediumTask,
        urgentTask,
      ]);

      await tasksPageController.listByStatus(
        TaskStatus.FINISHED,
        currentUser,
        res,
      );

      expect(mockTasksSerivce.getTasksByStatus).toHaveBeenCalledWith(
        1,
        'FINISHED',
      );
      expect(buildTaskVM).toHaveBeenCalledTimes(3);
      expect(buildTaskVM).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 1 }),
        'Asia/Taipei',
      );
      expect(buildTaskVM).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 2 }),
        'Asia/Taipei',
      );
      expect(buildTaskVM).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ id: 3 }),
        'Asia/Taipei',
      );

      expect(res.render).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/list-by-status');

      expect(model).toEqual(
        expect.objectContaining({
          status: 'Finished',
          totalTasks: 3,
        }),
      );
      expect(Array.isArray(model.viewModel)).toBe(true);
      expect(model.viewModel).toHaveLength(3);
      expect(model.viewModel[0]).toEqual(
        expect.objectContaining({
          id: 1,
          mockVm: true,
          mockTz: 'Asia/Taipei',
        }),
      );
      expect(model.viewModel[1]).toEqual(
        expect.objectContaining({
          id: 2,
          mockVm: true,
          mockTz: 'Asia/Taipei',
        }),
      );
      expect(model.viewModel[2]).toEqual(
        expect.objectContaining({
          id: 3,
          mockVm: true,
          mockTz: 'Asia/Taipei',
        }),
      );
    });

    it('should return with empty array', async () => {
      mockTasksSerivce.getTasksByStatus.mockResolvedValueOnce([]);

      await tasksPageController.listByStatus(
        TaskStatus.UNFINISHED,
        currentUser,
        res,
      );

      expect(buildTaskVM).not.toHaveBeenCalled();

      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/list-by-status');
      expect(model).toEqual(
        expect.objectContaining({
          status: 'Unfinished',
          totalTasks: 0,
        }),
      );
      expect(Array.isArray(model.viewModel)).toBe(true);
      expect(model.viewModel).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // listFuture
  // ───────────────────────────────────────────────────────────────────────────────

  describe('listFuture', () => {
    it('should render future tasks', async () => {
      mockTasksSerivce.getAllFutureTasks.mockResolvedValue([
        {
          ...lowTask,
          allDayLocalDate: new Date('2025-09-21T00:00:00.000Z'),
        },
      ]);
      await tasksPageController.listFuture(req, currentUser, res);

      expect(mockTasksSerivce.getAllFutureTasks).toHaveBeenCalledWith(
        1,
        'Asia/Taipei',
      );
      expect(buildTaskVM).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/list-by-status');
      expect(model).toEqual(
        expect.objectContaining({
          status: 'Future',
          totalTasks: 1,
        }),
      );
      expect(Array.isArray(model.viewModel)).toBe(true);
      expect(model.viewModel).toHaveLength(1);
      expect(model.viewModel[0]).toEqual(
        expect.objectContaining({ id: 1, mockVm: true, mockTz: 'Asia/Taipei' }),
      );
    });

    // ───────────────────────────────────────────────────────────────────────────────
    // detail
    // ───────────────────────────────────────────────────────────────────────────────

    describe('detail', () => {
      it('should renders details with VM locals', async () => {
        mockTasksSerivce.getTaskById.mockResolvedValueOnce(lowTask);

        await tasksPageController.detail(req, lowTask.id, currentUser, res);

        expect(mockTasksSerivce.getTaskById).toHaveBeenCalledWith(1, 1);
        expect(buildTaskVM).toHaveBeenCalledTimes(1);
        expect(buildTaskVM).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ id: 1 }),
          currentUser.timeZone,
        );

        expect(res.render).toHaveBeenCalledTimes(1);
        const [view, model] = (res.render as jest.Mock).mock.calls[0];
        expect(view).toBe('tasks/details');
        expect(model).toEqual(
          expect.objectContaining({
            mockTz: 'Asia/Taipei',
            mockVm: true,
            id: 1,
            title: 'low test',
          }),
        );
        expect(model).not.toBe(lowTask);
      });
    });

    // ───────────────────────────────────────────────────────────────────────────────
    // edit
    // ───────────────────────────────────────────────────────────────────────────────

    describe('edit', () => {
      const fixedNow = new Date('2025-01-02T00:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(fixedNow);
        mockTasksSerivce.getTaskById.mockResolvedValue(lowTask);
      });

      it('should render task edit page with mapped VM and todayISO', async () => {
        await tasksPageController.edit(lowTask.id, currentUser, res);

        // service called correctly
        expect(mockTasksSerivce.getTaskById).toHaveBeenCalledWith(
          lowTask.id,
          currentUser.userId,
        );

        // VM mapping called with correct tz
        expect(buildTaskVM).toHaveBeenCalledTimes(1);
        expect(buildTaskVM).toHaveBeenCalledWith(lowTask, currentUser.timeZone);

        // render checks
        expect(res.render).toHaveBeenCalledTimes(1);
        const [view, model] = (res.render as jest.Mock).mock.calls[0];
        expect(view).toBe('tasks/details-edit');

        // partial match on locals; don't assert the entire object
        expect(model).toEqual(
          expect.objectContaining({
            id: lowTask.id,
            title: lowTask.title,
            mockVm: true,
            mockTz: currentUser.timeZone,
            todayISO: '2025-01-02',
          }),
        );

        expect(model).not.toBe(lowTask);
      });
    });
  });
});
