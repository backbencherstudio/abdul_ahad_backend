import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Logger,
  BadRequestException,
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
import { MigrationJobService } from './migration-job.service';
import { JobAttemptService } from './job-attempt.service';
import { PriceMigrationService } from './price-migration.service';

export class RetryFailedJobDto {
  max_retries?: number;
  batch_size?: number;
  bypass_date_check?: boolean;
}

export class CancelJobDto {
  reason?: string;
}

export class CreateJobDto {
  plan_id: string;
  job_type: 'NOTICE' | 'MIGRATION';
  total_count?: number;
}

@ApiTags('Admin - Migration Job Management')
@Controller('admin/subscription/migration/jobs')
export class MigrationJobController {
  private readonly logger = new Logger(MigrationJobController.name);

  constructor(
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  /**
   * Get all migration jobs with optional filtering
   */
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get all migration jobs',
    description:
      'Returns all migration jobs with optional filtering by status, plan, and pagination',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter jobs by status',
    enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  })
  @ApiQuery({
    name: 'plan_id',
    required: false,
    description: 'Filter jobs by plan ID',
  })
  @ApiQuery({
    name: 'job_type',
    required: false,
    description: 'Filter jobs by type',
    enum: ['NOTICE', 'MIGRATION'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of jobs to return (default: 20)',
    type: 'number',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Number of jobs to skip (default: 0)',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved migration jobs',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              plan_id: { type: 'string' },
              plan_name: { type: 'string' },
              job_type: { type: 'string', enum: ['NOTICE', 'MIGRATION'] },
              status: {
                type: 'string',
                enum: [
                  'PENDING',
                  'RUNNING',
                  'COMPLETED',
                  'FAILED',
                  'CANCELLED',
                ],
              },
              created_at: { type: 'string', format: 'date-time' },
              started_at: { type: 'string', format: 'date-time' },
              completed_at: { type: 'string', format: 'date-time' },
              total_count: { type: 'number' },
              success_count: { type: 'number' },
              failed_count: { type: 'number' },
              progress_percentage: { type: 'number' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
            has_more: { type: 'boolean' },
          },
        },
      },
    },
  })
  async getJobs(
    @Query('status') status?: string,
    @Query('plan_id') planId?: string,
    @Query('job_type') jobType?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Req() req?: any,
  ) {
    try {
      const filters = {
        status: status as any,
        plan_id: planId,
        job_type: jobType as any,
        limit: limit || 20,
        offset: offset || 0,
      };

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested migration jobs with filters:`,
        filters,
      );

      const result = await this.migrationJobService.getJobs(filters);

      this.logger.log(
        `Retrieved ${result.jobs.length} migration jobs (total: ${result.pagination.total})`,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to get migration jobs:', error);
      throw error;
    }
  }

  /**
   * Get all active/running migration jobs across all plans
   */
  @Get('active')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get all active migration jobs',
    description:
      'Returns all currently running or pending migration jobs across all plans',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved active jobs',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        active_jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              plan_id: { type: 'string' },
              plan_name: { type: 'string' },
              job_type: { type: 'string', enum: ['NOTICE', 'MIGRATION'] },
              status: { type: 'string', enum: ['PENDING', 'RUNNING'] },
              created_at: { type: 'string', format: 'date-time' },
              started_at: { type: 'string', format: 'date-time' },
              total_count: { type: 'number' },
              success_count: { type: 'number' },
              failed_count: { type: 'number' },
              progress_percentage: { type: 'number' },
              recent_failures: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getActiveJobs(@Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested active migration jobs`,
      );

      const result = await this.migrationJobService.getActiveJobs();

      this.logger.log(
        `Retrieved ${result.active_jobs.length} active migration jobs`,
      );
      return result;
    } catch (error) {
      this.logger.error('Failed to get active migration jobs:', error);
      throw error;
    }
  }

  /**
   * Get job statistics for dashboard
   */
  @Get('statistics')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get migration job statistics',
    description:
      'Returns comprehensive statistics about migration jobs for dashboard display',
  })
  @ApiQuery({
    name: 'plan_id',
    required: false,
    description: 'Filter statistics by specific plan ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved job statistics',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        statistics: {
          type: 'object',
          properties: {
            total_jobs: { type: 'number' },
            completed_jobs: { type: 'number' },
            failed_jobs: { type: 'number' },
            running_jobs: { type: 'number' },
            pending_jobs: { type: 'number' },
            success_rate: { type: 'number' },
          },
        },
        recent_jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              plan_id: { type: 'string' },
              job_type: { type: 'string' },
              status: { type: 'string' },
              created_at: { type: 'string', format: 'date-time' },
              completed_at: { type: 'string', format: 'date-time' },
              success_count: { type: 'number' },
              failed_count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getJobStatistics(@Query('plan_id') planId?: string, @Req() req?: any) {
    try {
      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested job statistics${planId ? ` for plan ${planId}` : ''}`,
      );

      const result = await this.migrationJobService.getJobStatistics(planId);

      this.logger.log(
        `Retrieved job statistics: ${result.statistics.total_jobs} total jobs, ` +
          `${result.statistics.success_rate}% success rate`,
      );
      return result;
    } catch (error) {
      this.logger.error('Failed to get job statistics:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific job
   */
  @Get(':jobId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get job details',
    description:
      'Returns detailed information about a specific migration job including attempt history',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved job details',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            plan_id: { type: 'string' },
            plan_name: { type: 'string' },
            plan_price: { type: 'string' },
            job_type: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            started_at: { type: 'string', format: 'date-time' },
            completed_at: { type: 'string', format: 'date-time' },
            total_count: { type: 'number' },
            success_count: { type: 'number' },
            failed_count: { type: 'number' },
            error_message: { type: 'string' },
            progress_percentage: { type: 'number' },
          },
        },
        attempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subscription_id: { type: 'string' },
              garage_id: { type: 'string' },
              success: { type: 'boolean' },
              error_message: { type: 'string' },
              attempt_number: { type: 'number' },
              retry_after: { type: 'string', format: 'date-time' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async getJobDetails(@Param('jobId') jobId: string, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested details for job ${jobId}`,
      );

      const result = await this.migrationJobService.getJobDetails(jobId);

      this.logger.log(
        `Retrieved job details for ${jobId}: ${result.attempts.length} attempts, ` +
          `${result.job.progress_percentage}% complete`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to get job details for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get all jobs for a specific plan
   */
  @Get('plan/:planId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get jobs by plan',
    description: 'Returns all migration jobs for a specific subscription plan',
  })
  @ApiParam({ name: 'planId', description: 'Subscription plan ID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of jobs to return (default: 20)',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved plan jobs',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        plan_id: { type: 'string' },
        plan_name: { type: 'string' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              job_type: { type: 'string' },
              status: { type: 'string' },
              created_at: { type: 'string', format: 'date-time' },
              started_at: { type: 'string', format: 'date-time' },
              completed_at: { type: 'string', format: 'date-time' },
              total_count: { type: 'number' },
              success_count: { type: 'number' },
              failed_count: { type: 'number' },
              progress_percentage: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getJobsByPlan(
    @Param('planId') planId: string,
    @Query('limit') limit?: number,
    @Req() req?: any,
  ) {
    try {
      const jobLimit = limit ? Math.min(limit, 100) : 20; // Cap at 100

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested jobs for plan ${planId} (limit: ${jobLimit})`,
      );

      const result = await this.migrationJobService.getJobsByPlan(
        planId,
        jobLimit,
      );

      this.logger.log(
        `Retrieved ${result.jobs.length} jobs for plan ${planId} (${result.plan_name})`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to get jobs for plan ${planId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a running or pending job
   */
  @Put(':jobId/cancel')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Cancel migration job',
    description:
      'Cancels a running or pending migration job. Cannot cancel completed jobs.',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID to cancel' })
  @ApiResponse({
    status: 200,
    description: 'Successfully cancelled job',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        job_id: { type: 'string' },
        cancelled_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Cannot cancel completed job' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async cancelJob(
    @Param('jobId') jobId: string,
    @Body() body: CancelJobDto,
    @Req() req,
  ) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested to cancel job ${jobId}${body.reason ? ` (reason: ${body.reason})` : ''}`,
      );

      await this.migrationJobService.cancelJob(jobId);

      this.logger.log(`✅ Successfully cancelled migration job ${jobId}`);

      return {
        success: true,
        message: 'Migration job cancelled successfully',
        job_id: jobId,
        cancelled_at: new Date().toISOString(),
        reason: body.reason,
      };
    } catch (error) {
      this.logger.error(`Failed to cancel job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Retry failed attempts for a specific job
   */
  @Post(':jobId/retry')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Retry failed job attempts',
    description:
      'Retries failed attempts for a specific migration job with configurable parameters',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID to retry' })
  @ApiResponse({
    status: 200,
    description: 'Successfully initiated retry',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        job_id: { type: 'string' },
        retry_job_id: { type: 'string' },
        failed_attempts_found: { type: 'number' },
        retry_parameters: {
          type: 'object',
          properties: {
            max_retries: { type: 'number' },
            batch_size: { type: 'number' },
            bypass_date_check: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 400, description: 'No failed attempts to retry' })
  async retryFailedJob(
    @Param('jobId') jobId: string,
    @Body() body: RetryFailedJobDto,
    @Req() req,
  ) {
    try {
      const maxRetries = body.max_retries || 3;
      const batchSize = body.batch_size || 50;
      const bypassDateCheck = body.bypass_date_check || false;

      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested to retry failed attempts for job ${jobId} ` +
          `(max_retries: ${maxRetries}, batch_size: ${batchSize}, bypass_date_check: ${bypassDateCheck})`,
      );

      // Get the original job to determine plan and job type
      const originalJob = await this.migrationJobService.getJobDetails(jobId);

      if (!originalJob.success) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      // Get failed attempts that can be retried
      const failedAttempts =
        await this.jobAttemptService.getFailedAttemptsForRetry(
          jobId,
          maxRetries,
        );

      if (failedAttempts.count === 0) {
        throw new BadRequestException(
          'No failed attempts found that can be retried',
        );
      }

      // Create a new retry job
      const retryJob = await this.migrationJobService.createJob({
        plan_id: originalJob.job.plan_id,
        job_type: originalJob.job.job_type,
        total_count: Math.min(failedAttempts.count, batchSize),
      });

      // Start the retry job
      await this.migrationJobService.startJob(retryJob.job_id);

      // Process failed attempts in batches
      const attemptsToRetry = failedAttempts.failed_attempts.slice(
        0,
        batchSize,
      );
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const attempt of attemptsToRetry) {
        const newAttempt = await this.jobAttemptService.createAttempt({
          job_id: retryJob.job_id,
          subscription_id: attempt.subscription_id,
          garage_id: attempt.garage_id,
          attempt_number: attempt.attempt_number + 1,
        });

        try {
          // Retry the migration based on job type
          let result;
          if (originalJob.job.job_type === 'MIGRATION') {
            result = await this.priceMigrationService.migrateCustomer(
              attempt.subscription_id,
              bypassDateCheck,
            );
          } else {
            // For NOTICE jobs, we would re-send the notice email
            // This is a simplified retry - in practice, you might want to handle this differently
            throw new Error('Notice job retry not implemented yet');
          }

          if (result?.success) {
            await this.jobAttemptService.updateAttempt(newAttempt.attempt_id, {
              success: true,
            });
            succeeded++;
          } else {
            const errorMessage =
              'Retry failed - migration returned non-success';
            await this.jobAttemptService.updateAttempt(newAttempt.attempt_id, {
              success: false,
              error_message: errorMessage,
            });
            errors.push(
              `Subscription ${attempt.subscription_id}: ${errorMessage}`,
            );
            failed++;
          }
        } catch (error) {
          const errorMessage = (error as Error)?.message || 'Unknown error';
          await this.jobAttemptService.updateAttempt(newAttempt.attempt_id, {
            success: false,
            error_message: errorMessage,
          });
          errors.push(
            `Subscription ${attempt.subscription_id}: ${errorMessage}`,
          );
          failed++;
        }

        processed++;
      }

      // Complete the retry job
      await this.migrationJobService.completeJob(retryJob.job_id, {
        success: failed === 0,
        processed,
        succeeded,
        failed,
        error_message: errors.length > 0 ? errors.join('; ') : undefined,
      });

      this.logger.log(
        `✅ Retry job ${retryJob.job_id} completed for original job ${jobId}: ` +
          `processed=${processed}, succeeded=${succeeded}, failed=${failed}`,
      );

      return {
        success: true,
        message: `Retry job completed successfully. Processed ${processed} attempts.`,
        job_id: jobId,
        retry_job_id: retryJob.job_id,
        failed_attempts_found: failedAttempts.count,
        retry_parameters: {
          max_retries: maxRetries,
          batch_size: batchSize,
          bypass_date_check: bypassDateCheck,
        },
        statistics: {
          processed,
          succeeded,
          failed,
          success_rate:
            processed > 0 ? Math.round((succeeded / processed) * 100) : 0,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to retry job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new migration job (for manual job creation)
   */
  @Post()
  @CheckAbilities({ action: Action.Create, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Create migration job',
    description:
      'Manually creates a new migration job for a specific plan and job type',
  })
  @ApiResponse({
    status: 201,
    description: 'Successfully created migration job',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        plan_id: { type: 'string' },
        job_type: { type: 'string' },
        total_count: { type: 'number' },
        status: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async createJob(@Body() body: CreateJobDto, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested to create ${body.job_type} job for plan ${body.plan_id}`,
      );

      const result = await this.migrationJobService.createJob(body);

      this.logger.log(
        `✅ Created migration job ${result.job_id} for plan ${body.plan_id} (${result.total_count} subscriptions)`,
      );

      return {
        ...result,
        created_by: req.user?.email || 'unknown',
      };
    } catch (error) {
      this.logger.error(`Failed to create migration job:`, error);
      throw error;
    }
  }
}
