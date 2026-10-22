import type { ArgumentsHost } from '@nestjs/common';
import { Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

@Catch()
export class ReadApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ReadApiErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      return response.status(error.getStatus()).json(body);
    }
    this.logger.error('Read API request failed');
    return response.status(500).json({ timestamp: new Date().toISOString().replace(/Z$/, ''),
      status: 500, error: 'Internal Server Error', message: 'Đã xảy ra lỗi hệ thống',
      path: http.getRequest().path, fieldErrors: {} });
  }
}
