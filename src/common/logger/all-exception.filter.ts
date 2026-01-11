import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { loggerInstance } from './logger';

@Catch() // 空括號代表捕捉「所有」錯誤
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 1. 判定狀態碼
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // 2. 建立錯誤訊息物件
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // 3. 結構化日誌紀錄 (Winston)
    // 這是最重要的一步，確保所有非預期 Bug 都有 Stack Trace
    loggerInstance.error(
      `Unhandled Exception: ${request.method} ${request.url}`,
      {
        context: 'AllExceptionsFilter',
        status,
        path: request.url,
        method: request.method,
        ip: request.ip,
        // 如果是原生 Error 物件，印出堆疊追蹤
        stack: exception instanceof Error ? exception.stack : undefined,
        exception: exception, // 記錄原始異常內容
      },
    );

    // 4. 優雅回傳 JSON 給前端
    // 確保面試作品在出錯時依然保持專業的 API 格式
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'object' ? (message as any).message : message,
      error: 'Unexpected Error',
    });
  }
}
