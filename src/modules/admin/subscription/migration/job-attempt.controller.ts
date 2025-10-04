import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CheckAbilities } from '../../../../ability/abilities.decorator';
import { Action } from '../../../../ability/ability.factory';
import { JobAttemptService } from './job-attempt.service';

@ApiTags('Admin - Job Attempt Management')
@Controller('admin/subscription/migration/attempts')
export class JobAttemptController {
  private readonly logger = new Logger(JobAttemptController.name);

  constructor(private readonly jobAttemptService: JobAttemptService) {}

  /**
   * Get detailed information about a specific job attempt
   */
  @Get(':attemptId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get attempt details',
    description:
      'Returns detailed information about a specific job attempt including subscription and garage context',
  })
  @ApiParam({ name: 'attemptId', description: 'Job attempt ID' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved attempt details',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        attempt: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            job_id: { type: 'string' },
            plan_id: { type: 'string' },
            plan_name: { type: 'string' },
            job_type: { type: 'string' },
            job_status: { type: 'string' },
            subscription_id: { type: 'string' },
            garage_id: { type: 'string' },
            garage_name: { type: 'string' },
            garage_email: { type: 'string' },
            subscription_plan: { type: 'string' },
            current_price: { type: 'string' },
            attempt_number: { type: 'number' },
            success: { type: 'boolean' },
            error_message: { type: 'string' },
            retry_after: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Attempt not found' })
  async getAttemptDetails(@Param('attemptId') attemptId: string, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested details for attempt ${attemptId}`,
      );

      const result = await this.jobAttemptService.getAttemptDetails(attemptId);

      this.logger.log(
        `Retrieved attempt details for ${attemptId}: ${result.attempt.garage_name} - ${result.attempt.success ? 'SUCCESS' : 'FAILED'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get attempt details for ${attemptId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all attempts for a specific job with pagination
   */
  @Get('job/:jobId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get attempts by job',
    description:
      'Returns all job attempts for a specific migration job with pagination support',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: 'number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of attempts per page (default: 50, max: 100)',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved job attempts',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        attempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subscription_id: { type: 'string' },
              garage_id: { type: 'string' },
              garage_name: { type: 'string' },
              garage_email: { type: 'string' },
              attempt_number: { type: 'number' },
              success: { type: 'boolean' },
              error_message: { type: 'string' },
              retry_after: { type: 'string', format: 'date-time' },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async getAttemptsByJob(
    @Param('jobId') jobId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Req() req?: any,
  ) {
    try {
      const pageNum = Math.max(1, page || 1);
      const pageLimit = Math.min(100, Math.max(1, limit || 50)); // Cap at 100, minimum 1

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested attempts for job ${jobId} (page: ${pageNum}, limit: ${pageLimit})`,
      );

      const result = await this.jobAttemptService.getAttemptsByJob(
        jobId,
        pageNum,
        pageLimit,
      );

      this.logger.log(
        `Retrieved ${result.attempts.length} attempts for job ${jobId} (page ${pageNum}/${result.pagination.totalPages})`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to get attempts for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get failed attempts that are eligible for retry
   */
  @Get('job/:jobId/retryable')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get retryable failed attempts',
    description:
      'Returns failed attempts for a specific job that are eligible for retry based on attempt count and retry timing',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiQuery({
    name: 'max_retries',
    required: false,
    description: 'Maximum number of retries allowed (default: 3)',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved retryable attempts',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        failed_attempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subscription_id: { type: 'string' },
              garage_id: { type: 'string' },
              attempt_number: { type: 'number' },
              error_message: { type: 'string' },
              retry_after: { type: 'string', format: 'date-time' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'number' },
      },
    },
  })
  async getRetryableAttempts(
    @Param('jobId') jobId: string,
    @Query('max_retries') maxRetries?: number,
    @Req() req?: any,
  ) {
    try {
      const retryLimit = maxRetries || 3;

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested retryable attempts for job ${jobId} (max_retries: ${retryLimit})`,
      );

      const result = await this.jobAttemptService.getFailedAttemptsForRetry(
        jobId,
        retryLimit,
      );

      this.logger.log(
        `Found ${result.count} retryable failed attempts for job ${jobId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get retryable attempts for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get attempt statistics for a specific job
   */
  @Get('job/:jobId/statistics')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get attempt statistics',
    description:
      'Returns comprehensive statistics about attempts for a specific migration job',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved attempt statistics',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        statistics: {
          type: 'object',
          properties: {
            total_attempts: { type: 'number' },
            successful_attempts: { type: 'number' },
            failed_attempts: { type: 'number' },
            retryable_attempts: { type: 'number' },
            success_rate: { type: 'number' },
          },
        },
      },
    },
  })
  async getAttemptStatistics(@Param('jobId') jobId: string, @Req() req?: any) {
    try {
      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested attempt statistics for job ${jobId}`,
      );

      const result = await this.jobAttemptService.getAttemptStatistics(jobId);

      this.logger.log(
        `Retrieved attempt statistics for job ${jobId}: ${result.statistics.total_attempts} total, ` +
          `${result.statistics.success_rate}% success rate`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get attempt statistics for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clean up old completed attempts for a job (maintenance endpoint)
   */
  @Get('job/:jobId/cleanup')
  @CheckAbilities({ action: Action.Delete, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Clean up old attempts',
    description:
      'Cleans up old successful attempts for a completed job to free up database space',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiQuery({
    name: 'older_than_days',
    required: false,
    description: 'Clean up attempts older than this many days (default: 30)',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully cleaned up old attempts',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        job_id: { type: 'string' },
        cutoff_date: { type: 'string', format: 'date-time' },
        older_than_days: { type: 'number' },
      },
    },
  })
  async cleanupOldAttempts(
    @Param('jobId') jobId: string,
    @Query('older_than_days') olderThanDays?: number,
    @Req() req?: any,
  ) {
    try {
      const days = olderThanDays || 30;

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested cleanup for job ${jobId} (older than ${days} days)`,
      );

      await this.jobAttemptService.cleanupOldAttempts(jobId, days);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      this.logger.log(
        `✅ Cleaned up old attempts for job ${jobId} (older than ${days} days)`,
      );

      return {
        success: true,
        message: `Successfully cleaned up old attempts older than ${days} days`,
        job_id: jobId,
        cutoff_date: cutoffDate.toISOString(),
        older_than_days: days,
      };
    } catch (error) {
      this.logger.error(
        `Failed to cleanup old attempts for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }
}
