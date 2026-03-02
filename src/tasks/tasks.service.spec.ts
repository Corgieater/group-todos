import { Test, TestingModule } from '@nestjs/testing';
import {
  AssignmentStatus,
  GroupRole,
  Prisma,
} from 'src/generated/prisma/client';
import type {
  User as Usermodel,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import { TaskStatus } from './types/enum';
import { TasksService } from './tasks.service';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  TasksAddPayload,
  TaskUpdatePayload,
  TaskUpdateContext,
} from './types/tasks';
import { TaskPriority } from './types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { createMockTask } from 'src/test/factories/mock-task.factory';
import { MailService } from 'src/mail/mail.service';
import { SecurityService } from 'src/security/security.service';
import { createMockConfig } from 'src/test/factories/mock-config.factory';
import { ConfigService } from '@nestjs/config';
import { TasksGateWay } from './tasks.gateway';
import { createMockSecurityService } from 'src/test/factories/mock-security.service';

describe('TasksService', () => {
  let tasksService: TasksService;

  const mockUsersService = { findByIdOrThrow: jest.fn(), findById: jest.fn() };
  const mockPrismaService = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    groupMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    taskAssignee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    subTaskAssignee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        task: mockPrismaService.task,
        groupMember: mockPrismaService.groupMember,
        taskAssignee: mockPrismaService.taskAssignee,
        subTask: mockPrismaService.subTask,
        subTaskAssignee: mockPrismaService.subTaskAssignee,
      };
      return cb(tx);
    }),
  };
  const mockMailService = { sendTaskAssign: jest.fn() };

  const mockConfigService = createMockConfig();

  const mockSecurityService = createMockSecurityService();

  const mockTasksGateWay = {
    // 模擬 @WebSocketServer() server
    server: {
      to: jest.fn().mockReturnThis(), // 支援鏈式呼叫 .to().emit()
      emit: jest.fn(),
    },
    // 模擬 Gateway 裡的方法
    broadcastTaskUpdate: jest.fn(),
    handleJoinRoom: jest.fn(),
    heandleTyping: jest.fn(),
    handleStopTyping: jest.fn(),
  };

  const user: Usermodel = createMockUser();
  const lowTask: TaskModel = createMockTask();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfigService.mock },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
        { provide: TasksGateWay, useValue: mockTasksGateWay },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
  });

  const rewireTransaction = () => {
    mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
      return cb(mockPrismaService);
    });
  };

  beforeEach(() => {
    jest.resetAllMocks(); // ⬅️ 清掉實作 + 計數
    jest.restoreAllMocks(); // ⬅️ 還原 spy
    rewireTransaction(); // ⬅️ 重新掛回 $transaction 的實作
    mockUsersService.findByIdOrThrow.mockResolvedValue(createMockUser());
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // createTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createTask', () => {
    let payload: TasksAddPayload;

    beforeEach(() => {
      payload = {
        title: 'task1',
        status: null,
        priority: null,
        description: null,
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: null,
        location: null,
        userId: user.id,
      };

      mockPrismaService.task.create.mockResolvedValue({
        id: 1,
        ...payload,
        allDay: false,
      } as any);
    });

    it('creates an all-day task with defaults when optionals are null', async () => {
      await tasksService.createTask(payload);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.task.create).toHaveBeenCalled();

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];

      expect(data).toMatchObject({
        title: 'task1',
        description: null,
        dueAtUtc: new Date('2025-09-09T15:59:59.999Z'),
        allDayLocalDate: new Date('2025-09-09T00:00:00.000Z'),
        allDay: true,
        location: null,
      });

      expect(Object.keys(data)).toEqual(
        expect.arrayContaining([
          'title',
          'description',
          'dueAtUtc',
          'allDay',
          'location',
          'allDayLocalDate',
          'owner',
          'status',
          'priority',
        ]),
      );
    });

    it('creates a timed task (dueDate+dueTime→dueAtUtc) and applies status/priority', async () => {
      payload.allDay = false;
      payload.dueTime = '10:10';
      payload.status = TaskStatus.CLOSED;
      payload.priority = TaskPriority.HIGH;

      await tasksService.createTask(payload);

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];

      expect(data.dueAtUtc).toBeInstanceOf(Date);
      expect((data.dueAtUtc as Date).toISOString()).toBe(
        '2025-09-09T02:10:00.000Z',
      );

      expect(data).toMatchObject({
        status: TaskStatus.CLOSED,
        priority: TaskPriority.HIGH,
        allDay: false,
        dueAtUtc: new Date('2025-09-09T02:10:00.000Z'),
      });
    });

    it('should create group task', async () => {
      const groupId = 5;
      await tasksService.createTask(payload, groupId);

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];
      expect(data).toMatchObject({
        title: 'task1',
        description: null,
        dueAtUtc: new Date('2025-09-09T15:59:59.999Z'),
        allDayLocalDate: new Date('2025-09-09T00:00:00.000Z'),
        allDay: true,
        location: null,
      });
    });

    it('should not hit database when user not found', async () => {
      payload = {
        ...payload,
        userId: 999,
      };
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(tasksService.createTask(payload)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getTaskForViewer
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTaskForViewer', () => {
    // 根據您 service 裡面的 include 結構定義預期的參數
    const expectedInclude = {
      assignees: {
        // Task Assignees
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true, email: true } },
        },
      },
      subTasks: {
        // SubTasks 及其 Assignees
        include: {
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              // 注意：您 service code 中 subTasks.assignees 這裡缺少 assignedBy 的 include
            },
            orderBy: { status: 'asc' },
          },
        },
        orderBy: { priority: 'asc' },
      },
      group: { select: { name: true } }, // Group Name
    };

    // 輔助函式：創建一個完整的 Mock Task 結構
    const createFullMockTask = (overrides = {}) => ({
      ...lowTask, // 包含所有 Task 基礎欄位
      assignees: [],
      subTasks: [],
      group: null,
      ...overrides,
    });

    it('should return personal task for owner with isAdminish=true', async () => {
      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { ...lowTask, groupId: null };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        groupId: null,
        ownerId: user.id,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      const result = await tasksService.getTaskForViewer(lowTask.id, user.id); // actorId = ownerId

      // 驗證第 1 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(1, {
        where: { id: lowTask.id },
        select: { id: true, ownerId: true, groupId: true },
      });

      // 驗證第 2 次呼叫參數 (必須包含所有的 include 結構)
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: lowTask.id },
        include: expectedInclude,
      });

      expect(result.task.id).toBe(lowTask.id);
      expect(result.isAdminish).toBe(true);
    });

    it('should return group task for Owner (isAdminish=true)', async () => {
      const groupId = 2;
      const taskId = lowTask.id;

      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { id: taskId, ownerId: user.id, groupId };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        id: taskId,
        ownerId: user.id,
        groupId,
        group: { name: 'Test Group' },
        subTasks: [
          {
            id: 10,
            title: 'SubTask 1',
            status: TaskStatus.CLOSED, // 假設子任務已關閉，測試 canClose 邏輯
            assignees: [],
          },
        ],
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      // 🚀 修正：必須 Mock 獲取群組成員的列表 (findMany)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { user: { id: user.id, name: user.name, email: user.email } },
      ]);

      // 3. Mock 權限檢查 (findUnique)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.OWNER, // 確保回傳物件
      });

      const result = await tasksService.getTaskForViewer(taskId, user.id);

      // 驗證第 2 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: taskId },
        include: expectedInclude,
      });

      // 檢查 isAdminish 邏輯
      expect(result.isAdminish).toBe(true);
      expect(result.task.groupId).toBe(groupId);

      // 驗證成員列表是否有正確對應
      expect(result.groupMembers).toContainEqual({
        id: user.id,
        userName: user.name,
      });

      // 檢查 group.name
      if (result.task.group) {
        expect(result.task.group.name).toBe('Test Group');
      } else {
        throw new Error('Expected task.group to be defined for a group task.');
      }
    });

    it('should return group task for Non-Owner (isAdminish=false)', async () => {
      const nonOwnerId = 999;
      const groupId = 2;

      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { id: lowTask.id, ownerId: user.id, groupId };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        id: lowTask.id,
        ownerId: user.id,
        groupId,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      // 3. Mock 獲取群組成員 (findMany)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { user: { id: 1, name: 'Owner', email: 'owner@test.com' } },
        {
          user: {
            id: nonOwnerId,
            name: 'Non-Owner',
            email: 'nonowner@test.com',
          },
        },
      ]);

      // 4. Mock 權限檢查 (findUnique) - 必須回傳一個包含 role 的物件
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER, // 🚀 修正：回傳物件而非單純字串
      });

      const result = await tasksService.getTaskForViewer(
        lowTask.id,
        nonOwnerId,
      );

      // 斷言
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: lowTask.id },
        include: expectedInclude,
      });

      expect(result.isAdminish).toBe(false);
      expect(result.task.groupId).toBe(groupId);
      expect(result.groupMembers.length).toBe(2);
    });

    it('should throw TaskNotFoundError if parent task not found (Base query returns null)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(1); // 只執行了第一次查詢
    });

    it('should throw TaskNotFoundError if a personal task exists and actor is not owner', async () => {
      const nonOwnerId = 999;

      // 1. Mock 第一次查詢結果 (Base) - Task Owner ID 是 user.id (1)
      const baseTask = { ...lowTask, groupId: null, ownerId: user.id };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 驗證非 Owner 嘗試查看個人任務時被阻止
      await expect(
        tasksService.getTaskForViewer(lowTask.id, nonOwnerId),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(1); // 沒有進行第二次查詢
    });

    it('should throw TaskNotFoundError if full task lookup fails (Edge Case)', async () => {
      // 1. Mock 第一次查詢結果 (Base) - 成功
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      // 2. Mock 第二次查詢結果 - 失敗 (返回 null)
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(lowTask.id, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getHomeDashboardData
  // ───────────────────────────────────────────────────────────────────────────────
  describe('getHomeDashboardData', () => {
    it('should call listTaskCore and combine data correctly', async () => {
      const mockUser = { userId: user.id, timeZone: user.timeZone } as any;

      // 1. 準備測試資料
      const mockExpiredItems = [{ id: 'task-1', title: 'Expired Task' }];
      const mockTodayItems = [{ id: 'task-2', title: 'Today Task' }];
      const mockNoneItems = [{ id: 'task-3', title: 'No Date Task' }];
      const mockBounds = {
        start: '2026-02-21T00:00:00Z',
        end: '2026-02-21T23:59:59Z',
      };

      // 2. 建立 Spy 並模擬 listTaskCore 的回傳值
      // 因為 getHomeDashboardData 內部呼叫了三次 listTaskCore，我們使用 mockResolvedValueOnce 依序回傳
      const listTaskCoreSpy = jest.spyOn(tasksService as any, 'listTaskCore');

      listTaskCoreSpy
        .mockResolvedValueOnce({ items: mockExpiredItems }) // 第一次：EXPIRED
        .mockResolvedValueOnce({ items: mockTodayItems, bounds: mockBounds }) // 第二次：TODAY
        .mockResolvedValueOnce({ items: mockNoneItems }); // 第三次：NONE

      // 3. 執行測試目標
      const result = await tasksService.getHomeDashboardData(mockUser);

      // 4. 斷言 (Assertions)

      // 檢查回傳結構是否正確
      expect(result).toEqual({
        expired: mockExpiredItems,
        today: mockTodayItems,
        none: mockNoneItems,
        bounds: mockBounds,
      });

      // 檢查 listTaskCore 是否被呼叫了 3 次
      expect(listTaskCoreSpy).toHaveBeenCalledTimes(3);

      // 檢查第一次呼叫 (EXPIRED) 的參數
      expect(listTaskCoreSpy).toHaveBeenNthCalledWith(
        1,
        { kind: 'owner', ownerId: mockUser.userId },
        mockUser.timeZone,
        { status: ['OPEN'], due: ['EXPIRED'] },
        'expiredPriority',
        5,
      );

      // 檢查第二次呼叫 (TODAY) 的參數
      expect(listTaskCoreSpy).toHaveBeenNthCalledWith(
        2,
        { kind: 'owner', ownerId: mockUser.userId },
        mockUser.timeZone,
        { status: ['OPEN'], due: ['TODAY'] },
        'dueAtAscNullsLast',
        15,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getGroupDashboardData
  // ───────────────────────────────────────────────────────────────────────────────
  describe('getGroupDashboardData', () => {
    it('should return aggregated group dashboard data by calling listTaskCore with correct parameters', async () => {
      // 1. Arrange
      const groupId = 99;
      const mockViewer = {
        userId: 'user-888',
        timeZone: 'America/New_York',
      } as any;

      const mockExpiredItems = [{ id: 't1', title: 'Group Expired' }];
      const mockTodayItems = [{ id: 't2', title: 'Group Today' }];
      const mockNoneItems = [{ id: 't3', title: 'Group No Date' }];
      const mockBounds = {
        start: '2026-02-21T05:00:00Z',
        end: '2026-02-22T04:59:59Z',
      };

      // Spy on the internal listTaskCore method
      const listTaskCoreSpy = jest.spyOn(tasksService as any, 'listTaskCore');

      listTaskCoreSpy
        .mockResolvedValueOnce({ items: mockExpiredItems })
        .mockResolvedValueOnce({ items: mockTodayItems, bounds: mockBounds })
        .mockResolvedValueOnce({ items: mockNoneItems });

      // 2. Act
      const result = await tasksService.getGroupDashboardData(
        groupId,
        mockViewer,
      );

      // 3. Assert
      expect(result).toEqual({
        expired: mockExpiredItems,
        today: mockTodayItems,
        none: mockNoneItems,
        bounds: mockBounds,
      });

      // Verify the calls count
      expect(listTaskCoreSpy).toHaveBeenCalledTimes(3);

      // Verify the specific parameters for Group context
      const expectedContext = {
        kind: 'group',
        groupId: groupId,
        viewerId: mockViewer.userId,
      };

      // Check 1st call: EXPIRED
      expect(listTaskCoreSpy).toHaveBeenNthCalledWith(
        1,
        expectedContext,
        mockViewer.timeZone,
        { status: ['OPEN'], due: ['EXPIRED'] },
        'expiredPriority',
        5,
      );

      // Check 2nd call: TODAY
      expect(listTaskCoreSpy).toHaveBeenNthCalledWith(
        2,
        expectedContext,
        mockViewer.timeZone,
        { status: ['OPEN'], due: ['TODAY'] },
        'dueAtAscNullsLast',
        15,
      );

      // Check 3rd call: NONE
      expect(listTaskCoreSpy).toHaveBeenNthCalledWith(
        3,
        expectedContext,
        mockViewer.timeZone,
        { status: ['OPEN'], due: ['NONE'] },
        'createdAsc',
        10,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getTasks
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTasks', () => {
    const userId = 1;
    const timeZone = 'Asia/Taipei';

    it('Should return correct paginated data (basic query)', async () => {
      // 準備 Mock 回傳值
      const mockTasks = [
        { id: 1, title: 'Task 1', subTaskCount: 0, assigneeCount: 0 },
      ];
      const mockCount = [{ count: BigInt(1) }];

      // 第一次呼叫回傳 tasks, 第二次呼叫回傳 count (Promise.all)
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce(mockTasks)
        .mockResolvedValueOnce(mockCount);

      const result = await tasksService.getTasks(userId, timeZone, {
        status: 'OPEN',
        page: 1,
        limit: 10,
      });

      // 💡 取得該次呼叫的所有參數 (包含字串片段和傳入的值)
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];
      const fullSqlString = JSON.stringify(allArgs);

      // 現在你可以檢查是否包含這些條件了
      expect(fullSqlString).toContain('status');
      expect(fullSqlString).toContain('ownerId');
      expect(fullSqlString).toContain('OPEN');
    });

    it('should add time boundary when scope is future', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await tasksService.getTasks(userId, timeZone, {
        scope: 'FUTURE',
      });

      // 🚀 關鍵修正：將整個呼叫的所有參數（包含動態插入的 SQL 片段）字串化
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];
      const fullSqlContent = JSON.stringify(allArgs);

      // 驗證是否包含 Future 專用的時間判斷 SQL Fragment
      expect(fullSqlContent).toContain('dueAtUtc');
      expect(fullSqlContent).toContain('allDayLocalDate');
    });

    it('should calculate skip and limit correctly (pagination logic)', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      const page = 3;
      const limit = 5;
      const expectedSkip = (page - 1) * limit; // 10

      await tasksService.getTasks(userId, timeZone, { page, limit });

      // 在 $queryRaw`...` 這種寫法中：
      // 第一個參數是字串片段陣列
      // 後續參數（索引 1, 2, ...）才是傳進去的值
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];

      // 我們檢查所有傳入的參數是否包含 limit 和 expectedSkip
      // 因為我們不知道它們在參數列表中的確切位置（取決於 SQL 構造順序）
      expect(allArgs).toContain(limit);
      expect(allArgs).toContain(expectedSkip);
    });

    it('should return itemCount 0 if non count', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // 模擬空陣列回傳

      const result = await tasksService.getTasks(userId, timeZone, {});
      expect(result.meta.itemCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateTask', () => {
    const ctx: TaskUpdateContext = {
      id: lowTask.id,
      userId: user.id,
      timeZone: user.timeZone,
      userName: 'test',
      isAdminish: true,
      isOwner: true,
    };

    const payload: TaskUpdatePayload = {
      title: 'walk cat',
      description: 'walk your cat',
      location: 'london park',
      priority: TaskPriority.HIGH,
      allDay: false,
      dueDate: '2025-09-01',
      dueTime: '13:50',
    };

    it('should updates a non all-day task', async () => {
      const taskId = lowTask.id;

      // 1. 準備模擬回傳 Task 物件，防止 notifyTaskChange 崩潰
      const mockUpdatedTask = {
        id: taskId,
        ...payload,
        allDay: false,
        allDayLocalDate: null,
      };

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);

      // 🚀 關鍵：必須設定 Prisma update 的回傳值
      mockPrismaService.task.update.mockResolvedValueOnce(mockUpdatedTask);

      await tasksService.updateTask(ctx, payload);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      // 2. 修正斷言：Service 實作中目前 where 只有 { id }
      // 如果你希望 Service 具備權限檢查，請去 Service 加上 ownerId: userId
      expect(where).toEqual({ id: taskId });

      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: false,
        allDayLocalDate: null,
      });

      // 驗證安全性：確保 payload 裡的 ownerId 不會被惡意更新進去
      expect(Object.keys(data)).not.toEqual(
        expect.arrayContaining(['ownerId']),
      );
    });

    it('should updates an all-day task', async () => {
      const taskId = lowTask.id;
      const allDayPayload: TaskUpdatePayload = { ...payload, allDay: true };

      // 🚀 1. 準備模擬更新後回傳的 Task 資料
      const updatedTaskMock = {
        id: taskId,
        ...allDayPayload,
        // 補足 notifyTaskChange 或回傳需要的其他欄位
      };

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);

      // 🚀 2. 設定 Prisma Update 的 Mock 回傳值
      mockPrismaService.task.update.mockResolvedValueOnce(updatedTaskMock);

      await tasksService.updateTask(ctx, allDayPayload);

      // 驗證呼叫次數
      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);

      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      // 🚀 3. 修正斷言：實作代碼中 where 只有 { id }
      expect(where).toEqual({ id: taskId });

      // 驗證資料內容
      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: true,
      });
    });

    // it('should not hit database when user not found', async () => {
    //   mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
    //     UsersErrors.UserNotFoundError.byId(999),
    //   );

    //   await expect(
    //     tasksService.updateTask(lowTask.id, 999, payload),
    //   ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

    //   expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
    //   expect(mockPrismaService.task.update).not.toHaveBeenCalled();
    // });

    it('should throws TaskNotFoundError', async () => {
      ctx['id'] = 999;
      const e = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['id', 'userId'] },
      });
      mockPrismaService.task.update.mockRejectedValueOnce(e);

      await expect(
        tasksService.updateTask(ctx, payload),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateAssigneeStatus', () => {
    const actorId = 1;
    const taskId = 100;
    const groupId = 50;

    // 輔助函式：模擬 Task 資料
    const mockTask = (assignees: any[] = [], taskStatus = 'OPEN') => ({
      id: taskId,
      groupId: groupId,
      status: taskStatus,
      assignees,
    });

    describe('Success Cases', () => {
      it('should create a new assignment (Self-Claim) when no assignment exists and status is ACCEPTED', async () => {
        // 1. Arrange
        mockPrismaService.task.findUnique.mockResolvedValue(mockTask([])); // 無指派者
        mockPrismaService.groupMember.findUnique.mockResolvedValue({
          userId: actorId,
        }); // 是群組成員

        // 2. Act
        await tasksService.updateAssigneeStatus(taskId, actorId, {
          status: AssignmentStatus.ACCEPTED,
        });

        // 3. Assert
        expect(mockPrismaService.taskAssignee.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              taskId,
              assigneeId: actorId,
              status: AssignmentStatus.ACCEPTED,
            }),
          }),
        );
      });

      it('should update existing assignment status and call notifyTaskChange', async () => {
        // 1. Arrange
        const existingAssignee = { status: AssignmentStatus.PENDING };
        mockPrismaService.task.findUnique.mockResolvedValue(
          mockTask([existingAssignee]),
        );
        mockPrismaService.groupMember.findUnique.mockResolvedValue({
          userId: actorId,
        });

        // 模擬私有工具方法的回傳 (如果這些方法在 service 內部是 public 或可存取)
        jest
          .spyOn(tasksService as any, 'isValidAssignmentTransition')
          .mockReturnValue(true);
        jest
          .spyOn(tasksService as any, 'getAssigneeUpdateData')
          .mockReturnValue({ status: AssignmentStatus.COMPLETED });
        const notifySpy = jest
          .spyOn(tasksService as any, 'notifyTaskChange')
          .mockImplementation();

        // 2. Act
        await tasksService.updateAssigneeStatus(
          taskId,
          actorId,
          { status: AssignmentStatus.COMPLETED },
          'User Name',
        );

        // 3. Assert
        expect(mockPrismaService.taskAssignee.update).toHaveBeenCalled();
        expect(notifySpy).toHaveBeenCalledWith(
          taskId,
          actorId,
          'User Name',
          'ASSIGNEE_STATUS_UPDATED',
        );
      });
    });

    describe('Error Cases (Forbidden & Validation)', () => {
      it('should throw ForbiddenError if it is a personal task (no groupId)', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue({
          ...mockTask(),
          groupId: null,
        });

        await expect(
          tasksService.updateAssigneeStatus(taskId, actorId, {
            status: AssignmentStatus.ACCEPTED,
          }),
        ).rejects.toThrow();
      });

      it('should throw ForbiddenError if self-claiming with status other than ACCEPTED', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue(mockTask([])); // 無指派
        mockPrismaService.groupMember.findUnique.mockResolvedValue({
          userId: actorId,
        });

        await expect(
          tasksService.updateAssigneeStatus(taskId, actorId, {
            status: AssignmentStatus.DECLINED,
          }),
        ).rejects.toThrow();
      });

      it('should throw ForbiddenError if the status transition is illegal', async () => {
        const existingAssignee = { status: AssignmentStatus.COMPLETED };
        mockPrismaService.task.findUnique.mockResolvedValue(
          mockTask([existingAssignee]),
        );
        mockPrismaService.groupMember.findUnique.mockResolvedValue({
          userId: actorId,
        });

        // 模擬非法轉換
        jest
          .spyOn(tasksService as any, 'isValidAssignmentTransition')
          .mockReturnValue(false);

        await expect(
          tasksService.updateAssigneeStatus(taskId, actorId, {
            status: AssignmentStatus.PENDING,
          }),
        ).rejects.toThrow();
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('closeTask', () => {
    const mockTaskId = 1;
    const mockActorId = 99;
    const mockUserName = 'Test User';

    // 1. 測試：成功關閉（一般流程 - 所有子項目已完成）
    it('should successfully close a task when all items are completed', async () => {
      const ctx = {
        id: mockTaskId,
        userId: mockActorId,
        userName: mockUserName,
        isOwner: true,
        isAdminish: false,
      };

      // 模擬 findUnique 門票：全部 count 為 0
      mockPrismaService.task.findUnique.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.OPEN,
        _count: { subTasks: 0, assignees: 0 },
      });

      mockPrismaService.task.update.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.CLOSED,
      });

      const result = await tasksService.closeTask(ctx);

      expect(result.status).toBe(TaskStatus.CLOSED);
      expect(mockPrismaService.task.update).toHaveBeenCalled();
      // 驗證是否有發送 Socket 通知
      expect(mockTasksGateWay.broadcastTaskUpdate).toHaveBeenCalled();
    });

    // 2. 測試：觸發 Force Close 理由要求（當有未完成項目且沒給理由時）
    it('should throw FORCE_CLOSE_REASON_REQUIRED when open items exist without a reason', async () => {
      const ctx = {
        id: mockTaskId,
        userId: mockActorId,
        userName: mockUserName,
        isOwner: true,
        isAdminish: false,
      };

      // 模擬有 1 個未完成子任務
      mockPrismaService.task.findUnique.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.OPEN,
        _count: { subTasks: 1, assignees: 0 },
      });

      await expect(tasksService.closeTask(ctx)).rejects.toThrow(
        expect.objectContaining({ action: 'FORCE_CLOSE_REASON_REQUIRED' }),
      );
    });

    // 3. 測試：管理員成功「強制關閉」（有理由且具備 Admin 權限）
    it('should allow Admin to force close a task with a reason', async () => {
      const ctx = {
        id: mockTaskId,
        userId: mockActorId,
        userName: mockUserName,
        isOwner: false,
        isAdminish: true, // 👈 管理員
      };
      const opts = { reason: 'Force closing for deadline' };

      mockPrismaService.task.findUnique.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.OPEN,
        _count: { subTasks: 5, assignees: 2 },
      });

      mockPrismaService.task.update.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.CLOSED,
      });

      await tasksService.closeTask(ctx, opts);

      // 驗證 Transaction 內部的 updateMany 是否有被呼叫（清理子任務）
      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalled();
      expect(mockPrismaService.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ closedReason: opts.reason }),
        }),
      );
    });

    // 4. 測試：拒絕權限（非管理員嘗試在有未完成項目時強制關閉）
    it('should throw CLOSE_TASK error when non-admin tries to force close', async () => {
      const ctx = {
        id: mockTaskId,
        userId: mockActorId,
        userName: mockUserName,
        isOwner: true,
        isAdminish: false, // 👈 只是 Owner 不是 Admin
      };
      const opts = { reason: 'I want to close it anyway' };

      mockPrismaService.task.findUnique.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.OPEN,
        _count: { subTasks: 1, assignees: 0 },
      });

      await expect(tasksService.closeTask(ctx, opts)).rejects.toThrow(
        expect.objectContaining({ action: 'CLOSE_TASK' }),
      );
    });

    // 5. 測試：冪等性（如果任務已經是 CLOSED，直接回傳）
    it('should return immediately if task is already CLOSED', async () => {
      const ctx = {
        id: mockTaskId,
        userId: mockActorId,
        userName: mockUserName,
        isOwner: true,
        isAdminish: true,
      };

      mockPrismaService.task.findUnique.mockResolvedValue({
        id: mockTaskId,
        status: TaskStatus.CLOSED,
      });

      const result = await tasksService.closeTask(ctx);

      expect(mockPrismaService.task.update).not.toHaveBeenCalled();
      expect(result.status).toBe(TaskStatus.CLOSED);
    });
  });
  // ───────────────────────────────────────────────────────────────────────────────
  // archiveTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('archiveTask', () => {
    it('should archive task and sub tasks under it', async () => {
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(lowTask)
        .mockResolvedValueOnce(lowTask)
        .mockResolvedValueOnce(lowTask);
      await tasksService.archiveTask(1, user.id, true, true, 'test');

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });

      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: 1,
          status: { not: TaskStatus.ARCHIVED },
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should archive group task when adminish', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 1 };
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await tasksService.archiveTask(1, user.id, false, true, 'test');

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });

      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: 1,
          status: { not: TaskStatus.ARCHIVED },
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should throw TaskForbiddenError not adminish', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 2 };
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });

      await expect(
        tasksService.archiveTask(1, user.id, false, false, 'test'),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // restoreTask
  // ───────────────────────────────────────────────────────────────────────────────
  describe('restoreTask', () => {
    const taskId = 100;

    it('should restore task and its subtasks when restoring from ARCHIVED', async () => {
      // 1. 設定 Mock 傳回值 (改用 mockResolvedValue 或是設定兩次)
      // 第一次給 restoreTask 判斷 originalStatus
      // 第二次給 executeUpdateLogic 檢查權限與狀態
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce({ status: TaskStatus.ARCHIVED }) // 給 restoreTask
        .mockResolvedValueOnce({
          // 給 executeUpdateLogic
          id: taskId,
          ownerId: user.id, // 確保權限通過
          status: TaskStatus.ARCHIVED,
          groupId: null,
        });

      mockPrismaService.task.update.mockResolvedValue({
        id: taskId,
        status: TaskStatus.OPEN,
      });
      mockPrismaService.subTask.updateMany.mockResolvedValue({ count: 2 });

      // 確保狀態機檢查通過
      jest
        .spyOn(tasksService as any, 'taskStatusCanTransition')
        .mockReturnValue(true);

      // 2. 執行 Service 方法
      await tasksService.restoreTask(taskId, user.id, true, true, 'test');

      // 3. 斷言檢查
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: { taskId: taskId, status: TaskStatus.ARCHIVED },
        data: { status: TaskStatus.OPEN },
      });
    });

    it('should restore task and revert assignment statuses when restoring from CLOSED', async () => {
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce({ status: TaskStatus.CLOSED })
        .mockResolvedValueOnce({
          id: taskId,
          ownerId: user.id,
          status: TaskStatus.CLOSED,
          groupId: null,
        });

      mockPrismaService.task.update.mockResolvedValue({
        id: taskId,
        status: TaskStatus.OPEN,
      });
      mockPrismaService.taskAssignee.updateMany.mockResolvedValue({ count: 1 });

      jest
        .spyOn(tasksService as any, 'taskStatusCanTransition')
        .mockReturnValue(true);

      await tasksService.restoreTask(taskId, user.id, true, true, 'test');

      expect(mockPrismaService.taskAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [AssignmentStatus.SKIPPED, AssignmentStatus.DROPPED],
            },
          }),
          data: { status: AssignmentStatus.PENDING },
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // executeUpdateLogic
  // ───────────────────────────────────────────────────────────────────────────────
  describe('executeUpdateLogic', () => {
    const actorId = 1;
    const taskId = 100;
    const groupId = 50;

    // 模擬 Prisma Transaction Client
    const mockTx = {
      task: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      groupMember: {
        findUnique: jest.fn(),
      },
    } as any;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('Permission & Basics', () => {
      it('should throw TaskNotFoundError if task does not exist', async () => {
        mockTx.task.findUnique.mockResolvedValue(null);

        await expect(
          (tasksService as any).executeUpdateLogic(
            taskId,
            true,
            true,
            { newStatus: TaskStatus.OPEN, actorId },
            mockTx,
          ),
        ).rejects.toMatchObject({ action: undefined }); // 這是 NotFoundError，通常不帶 action
      });
    });

    describe('State Machine Validation', () => {
      it('should throw ILLEGAL_TRANSITION error if state machine denies move', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          status: TaskStatus.OPEN,
        });
        // 模擬狀態機不允許從 OPEN 直接跳到某個狀態
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(false);

        await expect(
          (tasksService as any).executeUpdateLogic(
            taskId,
            true,
            true,
            { newStatus: TaskStatus.ARCHIVED, actorId },
            mockTx,
          ),
        ).rejects.toMatchObject({
          action: expect.stringContaining('ILLEGAL_TRANSITION'),
        });
      });
    });

    describe('Closing Rules (Rule A: SubTasks)', () => {
      it('should throw error if attempting to close task with open subtasks', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          status: TaskStatus.OPEN,
          subTasks: [{ status: TaskStatus.OPEN }], // 有未完成子任務
        });
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(true);

        await expect(
          (tasksService as any).executeUpdateLogic(
            taskId,
            true,
            true,
            { newStatus: TaskStatus.CLOSED, actorId },
            mockTx,
          ),
        ).rejects.toMatchObject({
          action: 'CANNOT_CLOSE_TASK_WITH_OPEN_SUBTASKS',
        });
      });
    });

    describe('Closing Rules (Rule B: Assignees)', () => {
      it('should throw error if no assignees have completed the task', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          groupId: groupId,
          status: TaskStatus.OPEN,
          subTasks: [],
          assignees: [{ status: AssignmentStatus.ACCEPTED }], // 只是接受，未完成
        });
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(true);

        await expect(
          (tasksService as any).executeUpdateLogic(
            taskId,
            true,
            true,
            { newStatus: TaskStatus.CLOSED, actorId },
            mockTx,
          ),
        ).rejects.toMatchObject({
          action: 'CANNOT_CLOSE_WHEN_NO_ASSIGNEE_COMPLETED',
        });
      });

      it('should throw PARTIALLY_COMPLETED_NEEDS_FORCE if some assignees are not done and force is false', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          groupId: groupId,
          status: TaskStatus.OPEN,
          subTasks: [],
          assignees: [
            { status: AssignmentStatus.COMPLETED },
            { status: AssignmentStatus.ACCEPTED }, // 有人沒做完
          ],
        });
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(true);

        await expect(
          (tasksService as any).executeUpdateLogic(
            taskId,
            true,
            true,
            { newStatus: TaskStatus.CLOSED, actorId },
            mockTx,
          ),
        ).rejects.toMatchObject({ action: 'PARTIALLY_COMPLETED_NEEDS_FORCE' });
      });

      it('should allow closing with partially completed assignees if force is true', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          groupId: groupId,
          status: TaskStatus.OPEN,
          subTasks: [],
          assignees: [
            { status: AssignmentStatus.COMPLETED },
            { status: AssignmentStatus.ACCEPTED },
          ],
        });
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(true);

        await (tasksService as any).executeUpdateLogic(
          taskId,
          true,
          true,
          {
            newStatus: TaskStatus.CLOSED,
            actorId,
            force: true,
            reason: 'Testing Force',
          },
          mockTx,
        );

        expect(mockTx.task.update).toHaveBeenCalledWith({
          where: { id: taskId },
          data: expect.objectContaining({
            status: TaskStatus.CLOSED,
            closedReason: 'Testing Force',
            closedWithOpenAssignees: true,
          }),
        });
      });
    });

    describe('Update Logic (Restore)', () => {
      it('should reset audit fields when status is set back to OPEN', async () => {
        mockTx.task.findUnique.mockResolvedValue({
          ownerId: actorId,
          status: TaskStatus.CLOSED,
        });
        jest
          .spyOn(tasksService as any, 'taskStatusCanTransition')
          .mockReturnValue(true);

        await (tasksService as any).executeUpdateLogic(
          taskId,
          true,
          true,
          { newStatus: TaskStatus.OPEN, actorId },
          mockTx,
        );

        expect(mockTx.task.update).toHaveBeenCalledWith({
          where: { id: taskId },
          data: expect.objectContaining({
            status: TaskStatus.OPEN,
            closedAt: null,
            closedById: null,
            closedReason: null,
            closedWithOpenAssignees: false,
          }),
        });
      });
    });
  });
  // -----------------------subTask----------------------------

  // ───────────────────────────────────────────────────────────────────────────────
  // createSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createSubTask', () => {
    const actorId = 1;
    const parentTaskId = 100;

    const basePayload = {
      parentTaskId: parentTaskId,
      actorId: actorId,
      title: 'New Subtask',
      description: 'Subtask description',
      location: 'Office',
      priority: 2,
      allDay: false,
      dueDate: '2024-05-20',
      dueTime: '14:00',
      status: 'OPEN' as const,
      updatedBy: 'test',
    };

    const mockActor = { id: actorId, timeZone: 'Asia/Taipei' };

    beforeEach(() => {
      // 預設模擬 calculateTaskDates 回傳值 (避免測試依賴日期算法細節)
      jest.spyOn(tasksService as any, 'calculateTaskDates').mockReturnValue({
        dueAtUtc: new Date('2024-05-20T06:00:00Z'),
        allDayLocalDate: null,
      });
    });

    describe('Permission Validation', () => {
      it('should throw TaskNotFoundError if parent task does not exist', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue(null);
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);

        await expect(tasksService.createSubTask(basePayload)).rejects.toThrow(); // 會拋出 TaskNotFoundError
      });

      it('should throw TaskForbiddenError if trying to add subtask to a personal task not owned by actor', async () => {
        // 模擬個人任務，但 Owner 不是目前使用者
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: 999, // Other user
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);

        await expect(tasksService.createSubTask(basePayload)).rejects.toThrow(
          expect.objectContaining({
            action: 'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
          }),
        );
      });

      it('should throw TaskForbiddenError if trying to add subtask to a group task where actor is not a member', async () => {
        // 模擬團體任務
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: 999,
          groupId: 50, // Group ID exists
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);
        // 模擬該使用者不是成員
        mockPrismaService.groupMember.findUnique.mockResolvedValue(null);

        await expect(tasksService.createSubTask(basePayload)).rejects.toThrow(
          expect.objectContaining({
            action: 'CREATE_SUBTASK_ON_GROUP_TASK_NOT_MEMBER',
          }),
        );
      });
    });

    describe('Core Logic & Database Interaction', () => {
      it('should successfully create a subtask with correctly mapped data', async () => {
        // 模擬合法的個人任務 Owner
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: actorId,
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);
        mockPrismaService.subTask.create.mockResolvedValue({ id: 1 });

        await tasksService.createSubTask(basePayload);

        // 驗證日期計算被正確呼叫
        expect(tasksService['calculateTaskDates']).toHaveBeenCalledWith(
          basePayload.allDay,
          basePayload.dueDate,
          basePayload.dueTime,
          mockActor.timeZone,
        );

        // 驗證 Prisma Create 被正確呼叫
        expect(mockPrismaService.subTask.create).toHaveBeenCalledWith({
          data: {
            title: basePayload.title,
            description: basePayload.description,
            location: basePayload.location,
            status: 'OPEN',
            priority: 2,
            allDay: false,
            dueAtUtc: expect.any(Date),
            allDayLocalDate: null,
            task: { connect: { id: parentTaskId } },
          },
        });
      });

      it('should default priority to 3 if not provided in payload', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: actorId,
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);

        const { priority, ...payloadWithoutPriority } = basePayload;

        await tasksService.createSubTask(payloadWithoutPriority as any);

        expect(mockPrismaService.subTask.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              priority: 3,
            }),
          }),
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getSubTaskForViewer
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getSubTaskForViewer', () => {
    const mockSubTask = {
      id: 1,
      taskId: lowTask.id,
      title: 'Sub Task Example',
      status: 'OPEN',
      priority: 3,
      description: null,
      location: null,
      dueAtUtc: null,
      allDay: true,
      allDayLocalDate: null,
      sourceTimeZone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignees: [],
    };

    const mockGroupMembers = [
      {
        groupId: 1,
        userId: user.id,
        role: 'OWNER',
        joinedAt: new Date(),
        user: { id: 1, name: 'test1' },
      },
      {
        groupId: 1,
        userId: 2,
        role: 'MEMBER',
        joinedAt: new Date(),
        user: { id: 2, name: 'test2' },
      },
    ];

    it('should returns sub-task viewer data for an individual task owner', async () => {
      // 1. 準備資料：確保 groupId 為 null 以進入個人任務邏輯
      const personalParentTask = {
        ...lowTask,
        groupId: null,
        ownerId: user.id, // 當前使用者就是 Owner
      };

      // 模擬資料庫回傳的真實 SubTask 結構
      // 2. Mock 父任務查詢
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        personalParentTask,
      );

      // 3. Mock 子任務詳細資訊
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 4. 執行
      const result = await tasksService.getSubTaskForViewer(
        personalParentTask.id,
        mockSubTask.id,
        user.id,
      );

      // 5. 斷言 - 檢查查詢結構 (與實作代碼的 include 內容一致)
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: mockSubTask.id },
        include: {
          task: { select: { id: true, groupId: true } },
          closedBy: { select: { id: true, name: true } },
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              assignedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { status: 'asc' },
          },
        },
      });

      // 6. 斷言 - 檢查最終回傳物件內容
      expect(result).toEqual({
        subTask: mockSubTask,
        isAdminish: true, // 個人任務 Owner 預設為 isAdminish = true
        groupMembers: [], // 個人任務不應有群組成員列表
      });
    });

    it('should returns sub-task viewer data for a group member', async () => {
      // 準備資料
      const groupId = 1;
      const subTaskId = 1;
      const groupParentTask = { ...lowTask, groupId, ownerId: 999 };

      // 1. Mock 父任務查詢
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupParentTask);

      // 2. Mock 判定 Actor 為 Group Member (角色為 MEMBER)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: user.id,
        role: 'MEMBER',
      });

      // 3. Mock 子任務詳細資訊
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 4. Mock 獲取群組所有成員 (用於下拉選單)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce(
        mockGroupMembers,
      );

      // 執行
      const result = await tasksService.getSubTaskForViewer(
        groupParentTask.id,
        subTaskId,
        user.id,
      );

      // 斷言 1: 檢查查詢結構
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: subTaskId },
          include: expect.objectContaining({
            assignees: expect.anything(),
            task: expect.anything(),
          }),
        }),
      );

      // 斷言 2: 檢查最終組合的結果
      expect(result).toEqual({
        subTask: mockSubTask,
        isAdminish: false, // 因為角色是 MEMBER，Set<OWNER, ADMIN> 不包含它
        groupMembers: [
          { id: 1, userName: 'test1' },
          { id: 2, userName: 'test2' },
        ],
      });
    });

    it('should handle non-existent sub-task by returning empty viewer data', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce([]);

      const result = await tasksService.getSubTaskForViewer(
        lowTask.id,
        999,
        user.id,
      );

      expect(result).toEqual({
        groupMembers: [],
        isAdminish: true,
        subTask: [],
      });
    });

    it('should throw TaskNotFoundError if parent task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTaskForViewer(999, 1, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError if a personal parent task exists and actor not owner', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await expect(
        tasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError if a group parent task exists and actor not member', async () => {
      const parentTask = { ...lowTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(parentTask);
      // 模擬 actor 不是 group member
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTask', () => {
    const mockActorId = 1;
    const mockSubTaskId = 101;
    const mockActorTz = 'Asia/Taipei';
    const mockPayload: TaskUpdatePayload = {
      title: 'Updated SubTask Title',
      priority: 1,
    };

    it('should throw TaskNotFoundError if subTask does not exist', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValue(null);

      await expect(
        tasksService.updateSubTask(
          mockSubTaskId,
          mockActorId,
          mockActorTz,
          mockPayload,
        ),
      ).rejects.toThrow(TasksErrors.TaskNotFoundError);
    });

    it('should throw TaskNotFoundError if personal parent task is not owned by actor', async () => {
      // 模擬 subTask 屬於個人任務（groupId 為 null），但 ownerId 與 actorId 不同
      mockPrismaService.subTask.findUnique.mockResolvedValue({
        id: mockSubTaskId,
        task: {
          id: 50,
          ownerId: 999, // 不同人
          groupId: null,
        },
      });

      await expect(
        tasksService.updateSubTask(
          mockSubTaskId,
          mockActorId,
          mockActorTz,
          mockPayload,
        ),
      ).rejects.toThrow(TasksErrors.TaskNotFoundError);
    });

    it('should throw TaskNotFoundError if group task and actor is not a member', async () => {
      // 模擬 subTask 屬於群組任務，但 group.members 為空（代表 actor 不是成員）
      mockPrismaService.subTask.findUnique.mockResolvedValue({
        id: mockSubTaskId,
        task: {
          id: 50,
          ownerId: 1,
          groupId: 200,
          group: { members: [] }, // 不是成員
        },
      });

      await expect(
        tasksService.updateSubTask(
          mockSubTaskId,
          mockActorId,
          mockActorTz,
          mockPayload,
        ),
      ).rejects.toThrow(TasksErrors.TaskNotFoundError);
    });

    it('should successfully update and notify when all checks pass (Group Task)', async () => {
      // 1. 模擬權限校驗通過
      mockPrismaService.subTask.findUnique.mockResolvedValue({
        id: mockSubTaskId,
        taskId: 50,
        task: {
          id: 50,
          ownerId: 99,
          groupId: 200,
          group: { members: [{ role: 'MEMBER' }] },
        },
      });

      // 2. 模擬 update 成功
      mockPrismaService.subTask.update.mockResolvedValue({
        id: mockSubTaskId,
        taskId: 50,
      });

      // 執行
      await tasksService.updateSubTask(
        mockSubTaskId,
        mockActorId,
        mockActorTz,
        mockPayload,
      );

      // 3. 驗證資料處理 (getCommonUpdateData 的產出應該被帶入 update)
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: mockSubTaskId },
        data: expect.objectContaining({
          title: mockPayload.title,
          priority: Number(mockPayload.priority),
        }),
      });

      // 4. 驗證 Socket 通知是否正確發出
      expect(mockTasksGateWay.broadcastTaskUpdate).toHaveBeenCalledWith(
        50, // parentTaskId
        expect.objectContaining({
          type: 'SUBTASK_UPDATED',
          actorId: mockActorId,
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('closeSubTask', () => {
    const actorId = 1;
    const subTaskId = 10;

    it('should successfully close a subtask and record closer info', async () => {
      // 1. 準備模擬資料
      const mockSubTask = {
        id: subTaskId,
        title: 'Test SubTask',
        status: 'OPEN',
        task: {
          groupId: 1,
          group: { members: [{ userId: actorId, role: 'MEMBER' }] },
        },
      };

      // 2. Mock 查詢與更新
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      mockPrismaService.subTask.update.mockResolvedValueOnce({
        ...mockSubTask,
        status: TaskStatus.CLOSED,
        closedById: actorId,
        closedAt: new Date(),
      });

      // 3. 執行測試
      const result = await tasksService.closeSubTask(subTaskId, actorId);

      // 4. 斷言檢查
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: {
          id: subTaskId,
        },
        include: {
          task: {
            select: {
              id: true,
              ownerId: true,
              groupId: true,
              group: {
                select: {
                  members: {
                    where: { userId: actorId },
                    select: { role: true },
                  },
                },
              },
            },
          },
        },
      });

      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: actorId,
        },
      });

      expect(result.status).toBe(TaskStatus.CLOSED);
      expect(result.closedById).toBe(actorId);
    });

    it('should throw TaskNotFoundError if the subtask does not exist', async () => {
      // 模擬找不到任務
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(null);

      // 執行並檢查錯誤
      await expect(
        tasksService.closeSubTask(subTaskId, actorId),
      ).rejects.toThrow();

      // 確保沒有執行後續的 update
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTaskStatus', () => {
    const subTaskId = 50;
    const actorId = 1; // 任何人都可以操作

    // 模擬 SubTask 的基礎資料
    const mockSubTaskBase = {
      id: subTaskId,
      status: TaskStatus.OPEN,
    };

    it('should allow any authenticated actor to close an OPEN SubTask', async () => {
      // 1. Mock SubTask 存在且為 OPEN
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.OPEN,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.CLOSED,
        actorId: 999, // 非 owner/非 assignee 的用戶
      });

      // 驗證 findUnique 被呼叫 (只查詢 SubTask 狀態，無需父任務或權限資訊)
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: subTaskId },
        select: { id: true, status: true },
      });

      // 驗證 SubTask 被更新為 CLOSED
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 999,
        },
      });
    });

    it('should allow reopening a CLOSED SubTask (CLOSED -> OPEN)', async () => {
      // 1. Mock SubTask 存在且為 CLOSED
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.CLOSED,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.OPEN,
        actorId,
      });

      // 驗證 SubTask 被更新為 OPEN
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });
    });

    it('should allow archiving a CLOSED SubTask (CLOSED -> ARCHIVED)', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.CLOSED,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.ARCHIVED,
        actorId,
      });

      // 驗證 SubTask 被更新為 ARCHIVED (無需清除審計欄位)
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should throw TaskNotFoundError if SubTask is not found', async () => {
      // 1. Mock SubTask 找不到
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.updateSubTaskStatus(subTaskId, {
          newStatus: TaskStatus.CLOSED,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      // 驗證 update 沒有被呼叫
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError for illegal status transition (ARCHIVED -> CLOSED)', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.ARCHIVED,
      });

      // 嘗試從 ARCHIVED 轉移到 CLOSED (非法)
      await expect(
        tasksService.updateSubTaskStatus(subTaskId, {
          newStatus: TaskStatus.CLOSED,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      // 驗證 update 沒有被呼叫
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // restoreSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('restoreSubTask', () => {
    it('should update subTask status to OPEN and clear closure metadata', async () => {
      const subTaskId = 4;
      const mockUpdatedSubTask = {
        id: subTaskId,
        status: TaskStatus.OPEN,
        closedAt: null,
        closedById: null,
        title: 'Test Subtask',
      };

      mockPrismaService.subTask.update.mockResolvedValueOnce(
        mockUpdatedSubTask,
      );

      const result = await tasksService.restoreSubTask(subTaskId);

      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      expect(result).toEqual(mockUpdatedSubTask);
      expect(result.status).toBe(TaskStatus.OPEN);
      expect(result.closedAt).toBeNull();
    });

    it('should throw error if prisma update fails', async () => {
      const subTaskId = 999;
      mockPrismaService.subTask.update.mockRejectedValueOnce(
        new Error('Record not found'),
      );

      await expect(tasksService.restoreSubTask(subTaskId)).rejects.toThrow(
        'Record not found',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTaskAssigneeStatus', () => {
    const actorId = 1;
    const subTaskId = 10;
    const groupId = 2;
    const taskId = 100;

    // 模擬 subTask 及其關聯的 task 資訊
    const mockSubTask = {
      id: subTaskId,
      status: 'OPEN',
      task: { id: taskId, groupId, status: 'OPEN' },
    };

    it('should self-assign (claim) a subtask if no assignment record exists', async () => {
      // 1. Mock 子任務查詢
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 2. Mock 群組成員檢查
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });

      // 3. Mock 目前沒有指派紀錄
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce(null);

      // 4. Mock 建立紀錄
      mockPrismaService.subTaskAssignee.create.mockResolvedValueOnce({
        subTaskId,
        assigneeId: actorId,
      });

      // 執行
      await tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
        status: AssignmentStatus.ACCEPTED,
      });

      // 斷言：檢查是否正確建立了指派紀錄 (Claim)
      expect(mockPrismaService.subTaskAssignee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subTaskId,
          assigneeId: actorId,
          assignedById: actorId,
          status: AssignmentStatus.ACCEPTED,
          assignedAt: expect.any(Date),
          acceptedAt: expect.any(Date),
        }),
      });
    });

    it('should update status from ACCEPTED to COMPLETED for an existing record', async () => {
      // 1. Mock 子任務查詢
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 2. Mock 群組成員檢查
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });

      // 3. Mock 已有 ACCEPTED 紀錄
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce({
        status: AssignmentStatus.ACCEPTED,
      });

      // 4. Mock 更新
      mockPrismaService.subTaskAssignee.update.mockResolvedValueOnce({
        subTaskId,
        status: 'COMPLETED',
      });

      // 執行
      await tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
        status: AssignmentStatus.COMPLETED,
      });

      // 斷言：檢查是否呼叫了 update 並帶入正確的時間戳記 (由 getAssigneeUpdateData 產生)
      expect(mockPrismaService.subTaskAssignee.update).toHaveBeenCalledWith({
        where: {
          subTaskId_assigneeId: { subTaskId, assigneeId: actorId },
        },
        data: expect.objectContaining({
          status: AssignmentStatus.COMPLETED,
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should throw forbidden error if trying to claim with a status other than ACCEPTED', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce(null);

      // 嘗試在沒有紀錄的情況下直接傳送 COMPLETED
      await expect(
        tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
          status: AssignmentStatus.COMPLETED,
        }),
      ).rejects.toThrow();
      // 這裡會拋出 TasksErrors.TaskForbiddenError
    });

    it('should throw error if user is not a member of the group', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      // 模擬非成員
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
          status: AssignmentStatus.ACCEPTED,
        }),
      ).rejects.toThrow();
    });
  });

  // -----------------------Assign Tasks------------------------

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('assignTask', () => {
    const payload = {
      type: 'TASK',
      id: 1,
      assigneeId: 10,
      assignerId: 1,
      assignerName: 'test',
      updatedBy: 'test',
    };

    const mockTask = {
      groupId: 2,
      title: 'Test Task',
      priority: 1,
      description: 'desc',
      dueAtUtc: new Date(),
    };

    const mockTaskWithGroupMember = {
      id: payload.id,
      groupId: 2,
      group: {
        id: 2,
        name: 'Test Group',
        members: [{ userId: payload.assigneeId }],
      },
    };

    const mockAssigner = {
      groupId: 1,
      userId: 1,
      role: 'OWNER',
      joinedAt: '2025-12-01T02:58:24.612Z',
      user: { name: 'test1' },
      group: { name: 'test' },
    };
    it('should successfully assign a task using upsert (new assignment)', async () => {
      // 1. Mock 任務查詢 (必須包含 select 裡的所有欄位)
      mockPrismaService.task.findUnique.mockResolvedValueOnce(mockTask);

      // 2. Mock 指派者權限檢查 (第一次呼叫 groupMember)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(
        mockAssigner,
      );

      // 3. Mock 被指派者成員檢查 (第二次呼叫 groupMember)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: payload.assigneeId,
        groupId: 2,
      });

      // 4. Mock Upsert 成功
      mockPrismaService.taskAssignee.upsert.mockResolvedValueOnce({
        taskId: payload.id,
        assigneeId: payload.assigneeId,
      });

      // 5. 執行測試
      await tasksService.assignTask(payload);

      // 6. 修正斷言：確保與實作中的 select 一致
      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: {
          id: payload.id,
          status: 'OPEN', // 實作代碼中有這行，測試必須對應
        },
        select: expect.any(Object),
      });

      // 檢查 Upsert
      expect(mockPrismaService.taskAssignee.upsert).toHaveBeenCalled();
    });

    it('should throw TaskNotFoundError if task does not exist', async () => {
      // 模擬任務不存在
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.assignTask(payload)).rejects.toThrow();
    });

    it('should throw GroupMemberNotFoundError if assignee is not in the group', async () => {
      // 模擬任務存在，但 members 為空 (代表該人員不屬於此群組)
      const taskWithoutMember = {
        ...mockTaskWithGroupMember,
        group: { ...mockTaskWithGroupMember.group, members: [] },
      };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        taskWithoutMember,
      );

      await expect(tasksService.assignTask(payload)).rejects.toThrow();

      // 確保不會進到下一步的 upsert
      expect(mockPrismaService.taskAssignee.upsert).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getPendingAssignmentsDetails
  // ───────────────────────────────────────────────────────────────────────────────

  // describe('getPendingAssignmentsDetails', () => {
  //   const pendingTasks = [
  //     {
  //       task: {
  //         id: 66,
  //         priority: 1,
  //         title: 'test',
  //         dueAtUtc: '2025-12-17T00:28:00.000Z',
  //       },
  //       group: { id: 9, name: 'test group' },
  //     },
  //     {
  //       task: {
  //         id: 7,
  //         priority: 2,
  //         title: 'test',
  //         dueAtUtc: '2025-12-17T00:28:00.000Z',
  //       },
  //       group: { id: 2, name: 'test group2' },
  //     },
  //   ];
  //   const pendingSubTasks = [
  //     {
  //       subTask: {
  //         id: 11,
  //         priority: 3,
  //         taskId: 14,
  //         title: 'test sub',
  //         dueAtUtc: null,
  //       },
  //     },
  //   ];
  //   // get pending tasks from userId
  //   mockPrismaService.taskAssignee.findMany.mockResolvedValueOnce(pendingTasks);
  //   mockPrismaService.subTaskAssignee.findMany.mockResolvedValueOnce(
  //     pendingSubTasks,
  //   );
  //   const pendingDetails = await tasksService.getPendingAssignmentsDetails(
  //     user.id,
  //   );
  // });
});
