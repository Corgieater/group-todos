import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { TasksErrors } from 'src/errors';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SubTaskExistsGuard implements CanActivate {
  constructor(private prismaService: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const subTaskId = +request.params.id; // Sub-task ID
    const userId = request.user.userId;

    const subTask = await this.prismaService.subTask.findUnique({
      where: { id: subTaskId },
      include: { task: { select: { id: true, groupId: true, ownerId: true } } },
    });

    if (!subTask) {
      throw TasksErrors.TaskNotFoundError.byId(userId, subTaskId);
    }

    // 存入 context，方便後續使用
    request.subTaskContext = subTask;
    return true;
  }
}
