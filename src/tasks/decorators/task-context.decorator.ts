import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetTaskContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.taskContext; // 這就是你在 Guard 裡掛上去的那包資料
  },
);
