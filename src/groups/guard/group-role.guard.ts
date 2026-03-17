import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireRoles } from 'src/groups/decorators/require-roles.decorator';
import { GroupsService } from 'src/groups/groups.service';

@Injectable()
export class GroupRolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private groupService: GroupsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 取得 Controller 或 Method 上的 RequireRoles Metadata
    const roles = this.reflector.get<string[]>(
      RequireRoles,
      context.getHandler(),
    );

    // 如果該路由沒設定 @Roles，就直接放行
    if (!roles) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId; // 確保有解析 JWT
    const groupId = Number(request.params.id) || Number(request.params.groupId);

    // 如果是需要檢查角色的路由但沒提供 groupId，通常應該擋掉
    if (!groupId || !userId) {
      throw new NotFoundException('Group or user not found.');
    }

    // 2. 去資料庫查這個使用者在這個群組的身分
    const member = await this.groupService.getMember(groupId, userId);

    if (!member) {
      throw new NotFoundException('Group not found.');
    }

    // 3. 檢查身分是否在允許的名單內
    if (!roles.includes(member.role)) {
      throw new ForbiddenException(
        `Insufficient permissions; this action is limited to: ${roles.join(', ')}`,
      );
    }
    return true;
  }
}
