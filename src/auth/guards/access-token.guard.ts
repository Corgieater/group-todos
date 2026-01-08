import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';

@Injectable()
export class AccessTokenGuard extends AuthGuard('access-token') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 💡 檢查 Handler (Method) 或 Class 是否帶有 @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 如果是公開路由，直接回傳 true 放行，不執行 passport 的策略驗證
    if (isPublic) {
      return true;
    }

    // 否則執行原本的 'access-token' 策略檢查 (檢查 JWT)
    return super.canActivate(context);
  }
}
