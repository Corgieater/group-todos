import { ExecutionContext } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubTaskExistsGuard } from './sub-task-exists.guard';
import { TasksErrors } from 'src/errors';

describe('SubTaskExistsGuard', () => {
  let guard: SubTaskExistsGuard;
  let prisma: PrismaService;

  // 1. 建立符合 NestJS 層級的 Mock Context
  const createMockContext = (params: any, userId: number) => {
    // 🚀 1. 先把物件宣告出來，確保參考一致
    const mockRequest = {
      params,
      user: { userId },
      subTaskContext: {},
    };

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        // 🚀 2. 永遠回傳同一個 mockRequest 實體
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    // 建立 Prisma Mock
    prisma = {
      subTask: {
        findUnique: jest.fn(),
      },
    } as any;

    guard = new SubTaskExistsGuard(prisma);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw TaskNotFoundError if sub-task does not exist', async () => {
    // 模擬資料庫找不到東西
    (prisma.subTask.findUnique as jest.Mock).mockResolvedValue(null);

    const context = createMockContext({ id: '999' }, 1);

    await expect(guard.canActivate(context)).rejects.toThrow(
      TasksErrors.TaskNotFoundError,
    );

    // 驗證查詢參數是否正確（轉成數字）
    expect(prisma.subTask.findUnique).toHaveBeenCalledWith({
      where: { id: 999 },
      include: expect.any(Object),
    });
  });

  it('should return true and set subTaskContext if sub-task exists', async () => {
    const mockSubTask = {
      id: 50,
      title: 'Fix the bug',
      task: { id: 10, groupId: null, ownerId: 1 },
    };

    // 模擬資料庫回傳成功
    (prisma.subTask.findUnique as jest.Mock).mockResolvedValue(mockSubTask);

    const context = createMockContext({ id: '50' }, 1);
    const request = context.switchToHttp().getRequest();

    const result = await guard.canActivate(context);

    // 2. 驗證結果
    expect(result).toBe(true);
    expect(request.subTaskContext).toEqual(mockSubTask);
    expect(request.subTaskContext.id).toBe(50);
  });

  it('should correctly include parent task info in the query', async () => {
    (prisma.subTask.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      task: {},
    });

    const context = createMockContext({ id: '1' }, 1);
    await guard.canActivate(context);

    // 3. 驗證是否有正確 include 父任務（這對權限檢查接力很重要）
    expect(prisma.subTask.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          task: {
            select: { id: true, groupId: true, ownerId: true },
          },
        },
      }),
    );
  });
});
