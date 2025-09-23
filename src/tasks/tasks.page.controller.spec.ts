import { Test, TestingModule } from '@nestjs/testing';
import { Status, Task as TaskModel } from '@prisma/client';
import { TasksPageController } from './tasks.page.controller';
import { TasksService } from './tasks.service';
import { Request, Response } from 'express';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { User as userModel } from '@prisma/client';
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
  let user: userModel;
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
    getUnfinishedTasksTodayOrNoDueDate: jest.fn(),
    getExpiredTasks: jest.fn(),
    getTasksByStatus: jest.fn(),
    getAllFutureTasks: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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

  // ───────────────────────────────────────────────────────────────────────────────
  // home
  // ───────────────────────────────────────────────────────────────────────────────

  describe('home', () => {
    let todayUndatedTasks: TaskModel[];
    let expiredTasks: TaskModel[];
    beforeEach(() => {
      const now = new Date('2025-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);
      todayUndatedTasks = [
        { ...lowTask, dueAtUtc: new Date('2025-01-02T09:00:00Z') },
        { ...lowTask, id: 2, dueAtUtc: null },
      ];
      expiredTasks = [
        { ...mediumTask, id: 3, dueAtUtc: new Date('2025-01-01T09:00:00Z') },
      ];
    });

    it('should renders home with mapped tasks', async () => {
      mockTasksSerivce.getUnfinishedTasksTodayOrNoDueDate.mockResolvedValueOnce(
        todayUndatedTasks,
      );
      mockTasksSerivce.getExpiredTasks.mockResolvedValueOnce(expiredTasks);

      await tasksPageController.home(req, currentUser, res);

      expect(
        mockTasksSerivce.getUnfinishedTasksTodayOrNoDueDate,
      ).toHaveBeenCalledWith(currentUser.userId);
      expect(mockTasksSerivce.getExpiredTasks).toHaveBeenCalledWith(1);

      expect(
        mockTasksSerivce.getUnfinishedTasksTodayOrNoDueDate,
      ).toHaveBeenCalledTimes(1);
      expect(mockTasksSerivce.getExpiredTasks).toHaveBeenCalledTimes(1);

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

      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/home');
      expect(model).toEqual(
        expect.objectContaining({
          name: 'test',
          totalTasks: 3,
        }),
      );
      expect(model.todayUndatedTasks).toHaveLength(2);
      expect(model.expiredTasks).toHaveLength(1);

      // 確認真的「有被 map 過」（我們在 mock 里加了 _vm/_tz）
      expect(model.todayUndatedTasks[0]).toEqual(
        expect.objectContaining({ mockVm: true, mockTz: currentUser.timeZone }),
      );
      expect(model.expiredTasks[0]).toEqual(
        expect.objectContaining({ mockVm: true, mockTz: currentUser.timeZone }),
      );
    });

    it('should renders with empty arrays', async () => {
      mockTasksSerivce.getUnfinishedTasksTodayOrNoDueDate.mockResolvedValueOnce(
        [],
      );
      mockTasksSerivce.getExpiredTasks.mockResolvedValueOnce([]);

      await tasksPageController.home(req, currentUser, res);

      const [, model] = (res.render as jest.Mock).mock.calls[0];
      expect(model.totalTasks).toBe(0);
      expect(model.todayUndatedTasks).toEqual([]);
      expect(model.expiredTasks).toEqual([]);
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

      await tasksPageController.listByStatus(Status.FINISHED, currentUser, res);

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
        Status.UNFINISHED,
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
