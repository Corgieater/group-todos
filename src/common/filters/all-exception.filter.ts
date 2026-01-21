import { Response, Request } from 'express';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { loggerInstance } from '../logger/logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // 1. 提取結構化錯誤資訊
    const exceptionResponse: any =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      exceptionResponse?.message ||
      (exception as any)?.message ||
      'Internal server error';

    const errorCode = (exception as any)?.code || 'INTERNAL_SERVER_ERROR';

    // 2. 🚀 Winston Log 參數設計
    loggerInstance.error(`[Exception] ${request.method} ${request.url}`, {
      context: 'AllExceptionsFilter',
      requestId: request.headers['x-request-id'], // 如果有實作 Request ID 會更好追蹤
      user: (request as any).user?.userId, // 記錄是哪個使用者觸發的錯誤
      status,
      errorCode,
      message,
      // 只有在非 4xx 錯誤時記錄堆棧軌跡 (Stack Trace)，避免 Log 太雜亂
      stack: status >= 500 ? (exception as any)?.stack : undefined,
      body: request.body,
      query: request.query,
      ip: request.ip,
    });

    // 3. 判斷是否為 AJAX 請求
    const isAjax =
      request.xhr ||
      request.headers['x-requested-with'] === 'XMLHttpRequest' ||
      request.headers.accept?.includes('json') ||
      request.headers['content-type']?.includes('json');

    const finalMessage = Array.isArray(message) ? message[0] : message;

    if (isAjax) {
      // API 回傳：包含 code 讓前端可以根據代碼顯示不同 UI
      return response.status(status).json({
        statusCode: status,
        code: errorCode,
        message: finalMessage,
        timestamp: new Date().toISOString(),
      });
    } else {
      // 網頁回傳：利用 Session 傳遞錯誤訊息 (Flash Message)
      if (request.session) {
        (request.session as any).errorMessage = finalMessage;
      }

      // 跳轉回上一頁或指定的錯誤頁面
      const backUrl = request.header('Referer') || '/';
      return response.redirect(backUrl);
    }
  }
}
