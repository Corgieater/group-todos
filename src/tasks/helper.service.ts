import { Injectable } from '@nestjs/common';
import { TasksGateWay } from './tasks.gateway';
import { SecurityService } from 'src/security/security.service';
import { UsersService } from 'src/users/users.service';
import { UsersErrors } from 'src/errors';
import { UserAccessInfo } from 'src/auth/types/auth';

@Injectable()
export class TasksHelperService {
  constructor(
    private readonly tasksGateway: TasksGateWay,
    private readonly securityService: SecurityService,
    private readonly usersService: UsersService,
  ) {}

  async verifyDecisionAndGetAccess(token: string) {
    // 1. 驗證 Token
    const payload = await this.securityService.verifyTaskDecisionToken(token);

    // 2. 獲取使用者 (這裡可以用 findByIdOrThrow 簡化)
    const user = await this.usersService.findById(payload.userId);
    if (!user) {
      throw UsersErrors.UserNotFoundError.byId(payload.userId);
    }

    const accessPayload: UserAccessInfo = {
      sub: user.id,
      userName: user.name,
      email: user.email,
      timeZone: user.timeZone,
    };

    return { payload, accessPayload };
  }

  async notifyTaskChange(
    taskId: number,
    actorId: number,
    updatedBy: string | undefined,
    type: string,
  ) {
    this.tasksGateway.broadcastTaskUpdate(taskId, {
      type,
      taskId,
      userName: updatedBy,
      actorId,
    });
  }
}
