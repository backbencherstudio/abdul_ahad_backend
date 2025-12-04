import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response, Request } from 'express';

@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CustomExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let errorDetails: any = null;

    // Determine status and message based on exception type
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || res;
      errorDetails = typeof res === 'object' ? res : null;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle Prisma Specific Errors
      switch (exception.code) {
        case 'P2002': // Unique constraint violation
          status = HttpStatus.CONFLICT;
          message = 'Duplicate entry found. This record already exists.';
          break;
        case 'P2025': // Record not found
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found.';
          break;
        default:
          // For other Prisma errors, we might want to keep them as 500 or 400 depending on the code
          // But usually, unknown prisma errors are treated as bad requests or internal errors
          status = HttpStatus.BAD_REQUEST;
          message = `Database error`;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Database validation error';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Environment check
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Logging
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} - ${status} - ${JSON.stringify(message)}`,
      );
    }

    // Construct Response Body
    const responseBody: any = {
      success: false,
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Environment Specific Logic
    if (isDevelopment) {
      // Development: Send full details
      responseBody.error =
        exception instanceof Error ? exception.name : 'UnknownError';
      responseBody.stack = exception instanceof Error ? exception.stack : null;

      if (exception instanceof Prisma.PrismaClientKnownRequestError) {
        responseBody.prismaCode = exception.code;
        responseBody.prismaMeta = exception.meta;
      }
    } else {
      // Production: Sanitize
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        responseBody.message = 'Internal server error. Please contact support.';
      }
      // For 4xx errors, we usually want to show the validation message to the user, so we keep 'message'
      // But we ensure no internal stack traces or prisma codes are leaked (which we didn't add to responseBody above for prod)
    }

    response.status(status).json(responseBody);
  }
}
