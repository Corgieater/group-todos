import { ExecutionContext } from '@nestjs/common';
import { TaskMemberGuard } from './task-member.guard';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksErrors } from 'src/errors';

describe('TaskMemberGuard', () => {
  let guard: TaskMemberGuard;
  let prisma: PrismaService;

  // 輔助函式：建立 Mock 的 ExecutionContext
  const createMockContext = (params: any, user: any) => {
    // 1. 先建立一個固定的 request 物件
    const mockRequest = {
      params,
      user,
      taskContext: {},
    };

    return {
      switchToHttp: () => ({
        // 2. 讓 getRequest 永遠回傳同一個物件
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    // 建立 Prisma 的 Mock 物件
    prisma = {
      task: { findUnique: jest.fn() },
      groupMember: { findUnique: jest.fn() },
    } as any;
    guard = new TaskMemberGuard(prisma);
  });

  it('should throw TaskNotFoundError if task not found', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(null);
    const context = createMockContext({ id: '99' }, { userId: 1 });

    await expect(guard.canActivate(context)).rejects.toThrow(
      TasksErrors.TaskNotFoundError,
    );
  });

  describe('Personal task (groupId is null)', () => {
    it('should return isAdminish:true if user is the owner', async () => {
      const mockTask = { id: 1, ownerId: 1, groupId: null };
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);

      const context = createMockContext({ id: '1' }, { userId: 1 });

      // 💡 從 context 裡把那個固定的 request 拿出來
      const request = context.switchToHttp().getRequest();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      // 現在這行應該會過，因為 Guard 修改的是同一個 request 記憶體位址
      expect(request.taskContext.isAdminish).toBe(true);
      expect(request.taskContext.isOwner).toBe(true);
    });

    it('should throw TaskNotFound Error (for privacy) if not owner', async () => {
      const mockTask = { id: 1, ownerId: 1, groupId: null };
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);

      const context = createMockContext({ id: '1' }, { userId: 2 }); // 不同人

      await expect(guard.canActivate(context)).rejects.toThrow(
        TasksErrors.TaskNotFoundError,
      );
    });
  });

  describe('Group task (groupId not null)', () => {
    const mockTask = { id: 1, ownerId: 10, groupId: 50 };

    it('should set isAdminish:true if user is an admin', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
      (prisma.groupMember.findUnique as jest.Mock).mockResolvedValue({
        role: 'ADMIN',
      });

      const context = createMockContext({ id: '1' }, { userId: 1 });
      const request = context.switchToHttp().getRequest();

      await guard.canActivate(context);

      expect(request.taskContext.isAdminish).toBe(true);
      expect(request.taskContext.isMember).toBe(true);
    });

    it('should set isAdminish:false if user is just a member', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
      (prisma.groupMember.findUnique as jest.Mock).mockResolvedValue({
        role: 'MEMBER',
      });

      const context = createMockContext({ id: '1' }, { userId: 1 });
      const request = context.switchToHttp().getRequest();

      await guard.canActivate(context);

      expect(request.taskContext.isAdminish).toBe(false);
      expect(request.taskContext.isMember).toBe(true);
    });

    it('should throw TaskNotFoundError if user is not even a group member', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
      (prisma.groupMember.findUnique as jest.Mock).mockResolvedValue(null);

      const context = createMockContext({ id: '1' }, { userId: 1 });

      await expect(guard.canActivate(context)).rejects.toThrow(
        TasksErrors.TaskNotFoundError,
      );
    });
  });
});
