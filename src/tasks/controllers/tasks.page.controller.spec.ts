import { Test, TestingModule } from '@nestjs/testing';
import type {
  Task as TaskModel,
  User as UserModel,
} from 'src/generated/prisma/client';
import { TasksPageController } from './tasks.page.controller';
import { TasksService } from '../services/tasks.service';
import { PrismaService } from 'src/prisma/prisma.service';
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
  buildTaskVM: jest.fn((t: any, tz: string, isAdminish: boolean) => ({
    ...t,
    mockVm: true,
    mockTz: tz,
    mockIsAdminish: isAdminish,
  })),
}));
import { buildTaskVM } from 'src/common/helpers/util';
import { SubTasksService } from '../services/sub-tasks.service';

describe('TasksController', () => {
  let tasksPageController: TasksPageController;
  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;
  const lowTask: TaskModel = createMockTask();

  const mockPrismaService = {
    taskAssignee: {
      findUnique: jest.fn(),
    },
    task: {
      findUnique: jest.fn(),
    },
    subTaskAssignee: {
      findUnique: jest.fn(),
    },
  };

  const mockTasksService = {
    create: jest.fn(),
    getTaskForViewer: jest.fn(),
    getHomeDashboardData: jest.fn(),
    getTasks: jest.fn(),
    getAllFutureTasks: jest.fn(),
  };

  const mockSubTasksService = {
    getSubTaskForViewer: jest.fn(),
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
      providers: [
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TasksService, useValue: mockTasksService },
        { provide: SubTasksService, useValue: mockSubTasksService },
      ],
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
    it('should render and load task data separately', async () => {
      // 1. 準備測試資料
      const mockUser = { userId: 1, userName: 'Test User' };
      const mockDashboardData = {
        expired: [{ id: 1, title: 'Expired Task' }],
        today: [{ id: 2, title: 'Today Task' }],
        none: [{ id: 3, title: 'No Date Task' }],
        bounds: { timeZone: 'UTC' },
      };

      // 2. 設定 Mock Service 的回傳值
      mockTasksService.getHomeDashboardData.mockResolvedValue(
        mockDashboardData,
      );

      // 3. 執行測試 (模擬 @Req, @CurrentUser, @Res)
      await tasksPageController.home({} as any, mockUser as any, res);

      // 4. 驗證 Service 是否被正確呼叫
      expect(mockTasksService.getHomeDashboardData).toHaveBeenCalledWith({
        userId: mockUser.userId,
        userName: mockUser.userName,
      });

      // 5. 驗證 res.render 是否被呼叫，且參數正確
      expect(res.render).toHaveBeenCalledWith(
        'tasks/home',
        expect.objectContaining({
          name: 'Test User',
          expired: mockDashboardData.expired,
          today: mockDashboardData.today,
          none: mockDashboardData.none,
        }),
      );
    });

    it('should throw error if exception happens', async () => {
      const mockUser = { userId: 1, userName: 'Test User' };
      mockTasksService.getHomeDashboardData.mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        tasksPageController.home({} as any, mockUser as any, res),
      ).rejects.toThrow('DB Error');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // list
  // ───────────────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should render tasks/list-by-status with correct data', async () => {
      // 準備測試資料
      const mockUser = { userId: 1, timeZone: 'Asia/Taipei' };
      const mockQuery = { status: 'OPEN', page: 1, limit: 10 };
      const mockPageDto = {
        data: [
          {
            id: 1,
            title: 'Test Task',
            subTaskCount: 1,
            assigneeCount: 0,
            priority: 3,
            status: 'OPEN',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        meta: {
          itemCount: 1,
          pageCount: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      };

      // 設定 Service Mock 行為
      mockTasksService.getTasks.mockResolvedValue(mockPageDto);

      // 執行測試
      await tasksPageController.list(mockQuery as any, mockUser as any, res);

      // 驗證 1: Service 是否被正確呼叫
      expect(mockTasksService.getTasks).toHaveBeenCalledWith(
        1,
        'Asia/Taipei',
        expect.objectContaining({
          status: 'OPEN',
          page: 1,
          limit: 10,
        }),
      );

      // 驗證 2: render 是否被呼叫，且帶有正確的參數
      expect(res.render).toHaveBeenCalledWith(
        'tasks/list-by-status',
        expect.objectContaining({
          status: 'OPEN',
          viewModel: expect.any(Array),
          pageMeta: mockPageDto.meta,
          currentQuery: mockQuery,
        }),
      );

      // 驗證 3: ViewModel 轉換邏輯 (hasOpenItems)
      const renderArgs = (res.render as jest.Mock).mock.calls[0][1];
      expect(renderArgs.viewModel[0].hasOpenItems).toBe(true);
    });

    // ───────────────────────────────────────────────────────────────────────────────
    // detail
    // ───────────────────────────────────────────────────────────────────────────────

    describe('detail', () => {
      it('should renders details with VM locals', async () => {
        mockTasksService.getTaskForViewer.mockResolvedValueOnce({
          task: lowTask,
          isAdminish: true,
        });

        await tasksPageController.detail(req, lowTask.id, currentUser, res);

        expect(mockTasksService.getTaskForViewer).toHaveBeenCalledWith(1, 1);
        expect(buildTaskVM).toHaveBeenCalledTimes(1);
        expect(buildTaskVM).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ id: 1 }),
          currentUser.timeZone,
          true,
        );

        expect(res.render).toHaveBeenCalledTimes(1);
        const [view, model] = (res.render as jest.Mock).mock.calls[0];
        expect(view).toBe('tasks/details');
        expect(model).toEqual(
          expect.objectContaining({
            mockTz: 'Asia/Taipei',
            mockVm: true,
            mockIsAdminish: true,
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
        mockTasksService.getTaskForViewer.mockResolvedValue({
          task: lowTask,
          isAdminish: true,
        });
      });

      it('should render task edit page with mapped VM and todayISO', async () => {
        await tasksPageController.edit(lowTask.id, currentUser, res);

        // service called correctly
        expect(mockTasksService.getTaskForViewer).toHaveBeenCalledWith(
          lowTask.id,
          currentUser.userId,
        );

        // VM mapping called with correct tz
        expect(buildTaskVM).toHaveBeenCalledTimes(1);
        expect(buildTaskVM).toHaveBeenCalledWith(
          lowTask,
          currentUser.timeZone,
          true,
        );

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
            mockIsAdminish: true,
            todayISO: '2025-01-02',
          }),
        );

        expect(model).not.toBe(lowTask);
      });
    });
  });

  // -----------------------------subTask-----------------------------

  // ───────────────────────────────────────────────────────────────────────────────
  // renderCreateSubTaskPage
  // ───────────────────────────────────────────────────────────────────────────────
  describe('renderCreateSubTaskPage', () => {
    it('should render create sub-task page with parentTaskId', async () => {
      const parentTaskId = 42;

      await tasksPageController.renderCreateSubTaskPage(res, parentTaskId, req);

      expect(res.render).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('tasks/create-sub-task');
      expect(model).toEqual(
        expect.objectContaining({ parentTaskId: parentTaskId }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // subTaskDetail
  // ───────────────────────────────────────────────────────────────────────────────
  describe('editSubTaskDetail', () => {
    const parentTaskId = 100;
    const subTaskId = 20;
    let actorId: number;

    const mockSubTaskResult = {
      id: subTaskId,
      taskId: parentTaskId,
      title: 'Mock SubTask Title',
      allDay: false,
      allDayLocalDate: new Date('2025-12-25'),
      dueAtUtc: new Date('2025-12-25T10:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      priority: 3,
      status: 'OPEN',
      assignees: [],
    };

    // 模擬 getSubTaskForViewer 的完整回傳結構
    const mockServiceResponse = {
      subTask: mockSubTaskResult,
      isAdminish: false,
      groupMembers: [],
    };

    beforeEach(() => {
      actorId = currentUser.userId;
      jest.clearAllMocks(); // 一次重置所有 Mock，更乾淨

      // 🚀 修正：對應 Controller 呼叫的正確 Service 方法名
      mockSubTasksService.getSubTaskForViewer.mockResolvedValue(
        mockServiceResponse,
      );

      // 假設 buildTaskVM 有被 jest.mock
      (buildTaskVM as jest.Mock).mockReturnValue({
        mockVm: true,
        id: subTaskId,
      });
    });

    it('should render edit page with correct viewModel and taskId context', async () => {
      // 🚀 修正：呼叫正確的 Controller 方法
      await tasksPageController.editSubTaskDetail(
        res,
        parentTaskId,
        subTaskId,
        req, // 雖然 Controller 標記為 _req，測試中仍需傳入
        currentUser,
      );

      // 1. 驗證 Service 呼叫
      expect(mockSubTasksService.getSubTaskForViewer).toHaveBeenCalledWith(
        parentTaskId,
        subTaskId,
        actorId,
      );

      // 2. 驗證 buildTaskVM (第三個參數 isAdminish 固定傳 false)
      expect(buildTaskVM).toHaveBeenCalledWith(
        mockSubTaskResult,
        currentUser.timeZone,
        false,
      );

      // 3. 驗證渲染的 View 與 Data
      expect(res.render).toHaveBeenCalledWith(
        'tasks/sub-task-details-edit', // 🚀 修正：與 Controller 路徑對齊
        expect.objectContaining({
          mockVm: true,
          taskId: parentTaskId,
        }),
      );
    });
  });
});
