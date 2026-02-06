import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Observable, map } from 'rxjs';

@Injectable()
export class SerializationInterceptor implements NestInterceptor {
  constructor(private dto: any) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // 使用 plainToInstance 根據 DTO 的定義自動平行化
        return plainToInstance(this.dto, data, {
          excludeExtraneousValues: true, // 只保留 DTO 有定義的欄位，達成過濾效果
        });
      }),
    );
  }
}
