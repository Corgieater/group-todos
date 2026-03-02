import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { TasksErrors } from 'src/errors';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class TaskMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const taskId = +request.params.id;
    const userId = request.user.userId;

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, ownerId: true, groupId: true, status: true },
    });

    if (!task) throw TasksErrors.TaskNotFoundError.byId(userId, taskId);

    let isMember = false;
    let isAdminish = false;

    if (!task.groupId) {
      // 個人任務：擁有者就是成員，也是管理員
      isMember = task.ownerId === userId;
      isAdminish = isMember;
    } else {
      // 群組任務：查一次成員表
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: task.groupId, userId } },
        select: { role: true },
      });

      isMember = !!member;
      isAdminish = member
        ? member.role === 'ADMIN' || member.role === 'OWNER'
        : false;
    }

    // 🛑 核心攔截：如果連 Member 都不是，直接丟出 404
    if (!isMember) {
      throw TasksErrors.TaskNotFoundError.byId(userId, taskId);
    }

    // ✅ 存入 Request Context，供 Decorator 或 Interceptor 使用
    request.taskContext = {
      task,
      userId,
      isMember,
      isAdminish,
      isOwner: task.ownerId === userId,
    };

    return true;
  }
}
