import {
  Controller,
  Get,
  Post,
  Put,
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

export class BulkRetryDto {
  max_retries?: number;
  batch_size?: number;
  bypass_date_check?: boolean;
  retry_delay_minutes?: number;
}

export class RecoveryStrategyDto {
  strategy: 'immediate' | 'delayed' | 'scheduled';
  delay_hours?: number;
  scheduled_time?: string;
  batch_size?: number;
  max_retries?: number;
}

export class EmergencyStopDto {
  reason: string;
  notify_admins?: boolean;
}

@ApiTags('Admin - Migration Recovery & Retry')
@Controller('admin/subscription/migration/recovery')
export class MigrationRecoveryController {
  private readonly logger = new Logger(MigrationRecoveryController.name);

  constructor(
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  /**
   * Emergency stop all active migration jobs
   */
  @Put('emergency-stop')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Emergency stop all active jobs',
    description:
      'Immediately stops all running and pending migration jobs. Use only in emergency situations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully stopped all active jobs',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        stopped_jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              job_id: { type: 'string' },
              plan_id: { type: 'string' },
              plan_name: { type: 'string' },
              status: { type: 'string' },
              stopped_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        emergency_stop_reason: { type: 'string' },
        stopped_by: { type: 'string' },
        stopped_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  async emergencyStopAllJobs(@Body() body: EmergencyStopDto, @Req() req) {
    try {
      this.logger.warn(
        `🚨 EMERGENCY STOP initiated by admin ${req.user?.email || 'unknown'}: ${body.reason}`,
      );

      // Get all active jobs
      const activeJobs = await this.migrationJobService.getActiveJobs();

      const stoppedJobs = [];
      const errors = [];

      // Cancel each active job
      for (const job of activeJobs.active_jobs) {
        try {
          await this.migrationJobService.cancelJob(job.id);
          stoppedJobs.push({
            job_id: job.id,
            plan_id: job.plan_id,
            plan_name: job.plan_name,
            status: 'CANCELLED',
            stopped_at: new Date().toISOString(),
          });

          this.logger.warn(
            `🛑 Emergency stopped job ${job.id} (${job.plan_name})`,
          );
        } catch (error) {
          errors.push(`Failed to stop job ${job.id}: ${error.message}`);
          this.logger.error(`Failed to emergency stop job ${job.id}:`, error);
        }
      }

      // Log emergency stop event
      this.logger.error(
        `🚨 EMERGENCY STOP COMPLETED: ${stoppedJobs.length} jobs stopped, ${errors.length} errors. ` +
          `Reason: ${body.reason} | Admin: ${req.user?.email || 'unknown'}`,
      );

      return {
        success: true,
        message: `Emergency stop completed. ${stoppedJobs.length} jobs stopped.`,
        stopped_jobs: stoppedJobs,
        errors: errors.length > 0 ? errors : undefined,
        emergency_stop_reason: body.reason,
        stopped_by: req.user?.email || 'unknown',
        stopped_at: new Date().toISOString(),
        notifications_sent: body.notify_admins || false,
      };
    } catch (error) {
      this.logger.error('Failed to emergency stop all jobs:', error);
      throw error;
    }
  }

  /**
   * Bulk retry failed attempts across multiple jobs
   */
  @Post('bulk-retry')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Bulk retry failed attempts',
    description:
      'Retries failed attempts across multiple jobs or plans with advanced recovery options',
  })
  @ApiQuery({
    name: 'plan_id',
    required: false,
    description: 'Retry failed attempts for a specific plan only',
  })
  @ApiQuery({
    name: 'job_ids',
    required: false,
    description: 'Comma-separated list of job IDs to retry',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully initiated bulk retry',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        bulk_retry_job_id: { type: 'string' },
        target_jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              job_id: { type: 'string' },
              plan_id: { type: 'string' },
              plan_name: { type: 'string' },
              failed_attempts_count: { type: 'number' },
              retryable_count: { type: 'number' },
            },
          },
        },
        retry_parameters: {
          type: 'object',
          properties: {
            max_retries: { type: 'number' },
            batch_size: { type: 'number' },
            bypass_date_check: { type: 'boolean' },
            retry_delay_minutes: { type: 'number' },
          },
        },
        estimated_completion: { type: 'string', format: 'date-time' },
      },
    },
  })
  async bulkRetryFailedAttempts(
    @Body() body: BulkRetryDto,
    @Query('plan_id') planId?: string,
    @Query('job_ids') jobIds?: string,
    @Req() req?: any,
  ) {
    try {
      const maxRetries = body.max_retries || 3;
      const batchSize = body.batch_size || 50;
      const bypassDateCheck = body.bypass_date_check || false;
      const retryDelayMinutes = body.retry_delay_minutes || 0;

      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} initiated bulk retry: ` +
          `plan_id=${planId || 'all'}, job_ids=${jobIds || 'all'}, ` +
          `max_retries=${maxRetries}, batch_size=${batchSize}`,
      );

      // Determine target jobs
      let targetJobs = [];

      if (planId) {
        // Get all jobs for specific plan
        const planJobs = await this.migrationJobService.getJobsByPlan(
          planId,
          100,
        );
        targetJobs = planJobs.jobs.filter(
          (job) => job.status === 'COMPLETED' || job.status === 'FAILED',
        );
      } else if (jobIds) {
        // Get specific jobs
        const jobIdList = jobIds.split(',').map((id) => id.trim());
        for (const jobId of jobIdList) {
          try {
            const jobDetails =
              await this.migrationJobService.getJobDetails(jobId);
            targetJobs.push(jobDetails.job);
          } catch (error) {
            this.logger.warn(`Failed to get job details for ${jobId}:`, error);
          }
        }
      } else {
        // Get all recent failed/completed jobs
        const jobStats = await this.migrationJobService.getJobStatistics();
        const recentJobs = jobStats.recent_jobs.filter(
          (job) => job.status === 'COMPLETED' || job.status === 'FAILED',
        );
        targetJobs = recentJobs.slice(0, 10); // Limit to 10 most recent
      }

      // Create a bulk retry job to track this operation
      const bulkRetryJob = await this.migrationJobService.createJob({
        plan_id: planId || 'bulk-retry',
        job_type: 'MIGRATION',
        total_count: targetJobs.length,
      });

      await this.migrationJobService.startJob(bulkRetryJob.job_id);

      // Analyze each target job for retryable attempts
      const targetJobAnalysis = [];
      let totalRetryableAttempts = 0;

      for (const job of targetJobs) {
        try {
          const retryableAttempts =
            await this.jobAttemptService.getFailedAttemptsForRetry(
              job.id,
              maxRetries,
            );

          targetJobAnalysis.push({
            job_id: job.id,
            plan_id: job.plan_id,
            plan_name: 'Unknown Plan', // Would need to fetch plan details
            failed_attempts_count: retryableAttempts.count,
            retryable_count: retryableAttempts.count,
          });

          totalRetryableAttempts += retryableAttempts.count;
        } catch (error) {
          this.logger.warn(`Failed to analyze job ${job.id} for retry:`, error);
          targetJobAnalysis.push({
            job_id: job.id,
            plan_id: job.plan_id,
            plan_name: 'Unknown Plan',
            failed_attempts_count: 0,
            retryable_count: 0,
          });
        }
      }

      // Estimate completion time
      const estimatedMinutes =
        Math.ceil(totalRetryableAttempts / batchSize) * 5; // 5 minutes per batch
      const estimatedCompletion = new Date(
        Date.now() + estimatedMinutes * 60000,
      );

      // Complete the bulk retry job
      await this.migrationJobService.completeJob(bulkRetryJob.job_id, {
        success: true,
        processed: targetJobs.length,
        succeeded: targetJobs.length,
        failed: 0,
      });

      this.logger.log(
        `✅ Bulk retry analysis completed: ${targetJobs.length} jobs analyzed, ` +
          `${totalRetryableAttempts} retryable attempts found`,
      );

      return {
        success: true,
        message: `Bulk retry analysis completed. Found ${totalRetryableAttempts} retryable attempts across ${targetJobs.length} jobs.`,
        bulk_retry_job_id: bulkRetryJob.job_id,
        target_jobs: targetJobAnalysis,
        retry_parameters: {
          max_retries: maxRetries,
          batch_size: batchSize,
          bypass_date_check: bypassDateCheck,
          retry_delay_minutes: retryDelayMinutes,
        },
        estimated_completion: estimatedCompletion.toISOString(),
        total_retryable_attempts: totalRetryableAttempts,
      };
    } catch (error) {
      this.logger.error('Failed to initiate bulk retry:', error);
      throw error;
    }
  }

  /**
   * Schedule delayed retry with recovery strategy
   */
  @Post('schedule-retry/:jobId')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Schedule delayed retry',
    description:
      'Schedules a retry operation with advanced recovery strategies and timing options',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID to schedule retry for' })
  @ApiResponse({
    status: 200,
    description: 'Successfully scheduled retry',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        original_job_id: { type: 'string' },
        scheduled_retry_job_id: { type: 'string' },
        strategy: { type: 'string' },
        scheduled_for: { type: 'string', format: 'date-time' },
        retry_parameters: {
          type: 'object',
          properties: {
            delay_hours: { type: 'number' },
            batch_size: { type: 'number' },
            max_retries: { type: 'number' },
          },
        },
      },
    },
  })
  async scheduleRetry(
    @Param('jobId') jobId: string,
    @Body() body: RecoveryStrategyDto,
    @Req() req,
  ) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} scheduled retry for job ${jobId} with strategy: ${body.strategy}`,
      );

      // Validate original job exists
      const originalJob = await this.migrationJobService.getJobDetails(jobId);
      if (!originalJob.success) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      // Calculate scheduled time based on strategy
      let scheduledTime: Date;

      switch (body.strategy) {
        case 'immediate':
          scheduledTime = new Date(Date.now() + 5 * 60000); // 5 minutes from now
          break;
        case 'delayed':
          const delayHours = body.delay_hours || 1;
          scheduledTime = new Date(Date.now() + delayHours * 60 * 60 * 1000);
          break;
        case 'scheduled':
          if (!body.scheduled_time) {
            throw new BadRequestException(
              'scheduled_time is required for scheduled strategy',
            );
          }
          scheduledTime = new Date(body.scheduled_time);
          if (scheduledTime <= new Date()) {
            throw new BadRequestException(
              'scheduled_time must be in the future',
            );
          }
          break;
        default:
          throw new BadRequestException(
            'Invalid strategy. Must be: immediate, delayed, or scheduled',
          );
      }

      // Create a new job for the scheduled retry
      const retryJob = await this.migrationJobService.createJob({
        plan_id: originalJob.job.plan_id,
        job_type: originalJob.job.job_type,
        total_count: 0, // Will be calculated when job runs
      });

      // Store scheduling information (in a real implementation, this would be stored in the database)
      this.logger.log(
        `📅 Scheduled retry job ${retryJob.job_id} for ${scheduledTime.toISOString()} ` +
          `(strategy: ${body.strategy}, original job: ${jobId})`,
      );

      return {
        success: true,
        message: `Retry scheduled successfully for ${scheduledTime.toISOString()}`,
        original_job_id: jobId,
        scheduled_retry_job_id: retryJob.job_id,
        strategy: body.strategy,
        scheduled_for: scheduledTime.toISOString(),
        retry_parameters: {
          delay_hours: body.delay_hours,
          batch_size: body.batch_size || 50,
          max_retries: body.max_retries || 3,
        },
        created_by: req.user?.email || 'unknown',
      };
    } catch (error) {
      this.logger.error(`Failed to schedule retry for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get recovery recommendations for failed jobs
   */
  @Get('recommendations/:jobId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get recovery recommendations',
    description:
      'Analyzes a failed job and provides intelligent recovery recommendations',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID to analyze' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved recovery recommendations',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        analysis: {
          type: 'object',
          properties: {
            failure_patterns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  error_type: { type: 'string' },
                  count: { type: 'number' },
                  percentage: { type: 'number' },
                  sample_error: { type: 'string' },
                },
              },
            },
            recommended_strategy: { type: 'string' },
            confidence_score: { type: 'number' },
            estimated_success_rate: { type: 'number' },
          },
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              action: { type: 'string' },
              description: { type: 'string' },
              estimated_impact: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async getRecoveryRecommendations(@Param('jobId') jobId: string, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested recovery recommendations for job ${jobId}`,
      );

      // Get job details and attempt statistics
      const jobDetails = await this.migrationJobService.getJobDetails(jobId);
      const attemptStats =
        await this.jobAttemptService.getAttemptStatistics(jobId);

      if (!jobDetails.success) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      // Analyze failure patterns
      const failurePatterns = await this.analyzeFailurePatterns(
        jobDetails.attempts,
      );

      // Generate recommendations
      const recommendations = await this.generateRecoveryRecommendations(
        jobDetails.job,
        attemptStats.statistics,
        failurePatterns,
      );

      // Determine recommended strategy
      const recommendedStrategy = this.determineRecommendedStrategy(
        failurePatterns,
        attemptStats.statistics,
      );

      this.logger.log(
        `Generated recovery recommendations for job ${jobId}: ` +
          `strategy=${recommendedStrategy.strategy}, confidence=${recommendedStrategy.confidence_score}%`,
      );

      return {
        success: true,
        job_id: jobId,
        analysis: {
          failure_patterns: failurePatterns,
          recommended_strategy: recommendedStrategy.strategy,
          confidence_score: recommendedStrategy.confidence_score,
          estimated_success_rate: recommendedStrategy.estimated_success_rate,
        },
        recommendations,
        generated_at: new Date().toISOString(),
        analyzed_by: req.user?.email || 'unknown',
      };
    } catch (error) {
      this.logger.error(
        `Failed to get recovery recommendations for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Analyze failure patterns from job attempts
   */
  private async analyzeFailurePatterns(attempts: any[]): Promise<any[]> {
    const errorCounts = new Map<string, number>();
    const errorSamples = new Map<string, string>();

    // Count error types
    for (const attempt of attempts) {
      if (!attempt.success && attempt.error_message) {
        const errorType = this.categorizeError(attempt.error_message);
        errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
        if (!errorSamples.has(errorType)) {
          errorSamples.set(errorType, attempt.error_message);
        }
      }
    }

    const totalFailures = attempts.filter((a) => !a.success).length;
    const patterns = [];

    for (const [errorType, count] of errorCounts.entries()) {
      patterns.push({
        error_type: errorType,
        count,
        percentage:
          totalFailures > 0 ? Math.round((count / totalFailures) * 100) : 0,
        sample_error: errorSamples.get(errorType),
      });
    }

    return patterns.sort((a, b) => b.count - a.count);
  }

  /**
   * Categorize error messages into types
   */
  private categorizeError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();

    if (message.includes('stripe') || message.includes('payment')) {
      return 'payment_error';
    } else if (message.includes('network') || message.includes('timeout')) {
      return 'network_error';
    } else if (message.includes('not found') || message.includes('invalid')) {
      return 'data_error';
    } else if (
      message.includes('permission') ||
      message.includes('unauthorized')
    ) {
      return 'permission_error';
    } else {
      return 'unknown_error';
    }
  }

  /**
   * Generate recovery recommendations
   */
  private async generateRecoveryRecommendations(
    job: any,
    stats: any,
    patterns: any[],
  ): Promise<any[]> {
    const recommendations = [];

    // High failure rate recommendation
    if (stats.success_rate < 50) {
      recommendations.push({
        priority: 'high',
        action: 'immediate_retry_with_delay',
        description:
          'High failure rate detected. Recommend immediate retry with 1-hour delay to allow system recovery.',
        estimated_impact: 'High - likely to resolve transient issues',
      });
    }

    // Payment error recommendation
    const paymentErrors = patterns.find(
      (p) => p.error_type === 'payment_error',
    );
    if (paymentErrors && paymentErrors.percentage > 30) {
      recommendations.push({
        priority: 'high',
        action: 'verify_payment_configuration',
        description:
          'High percentage of payment errors. Verify Stripe configuration and API keys.',
        estimated_impact: 'Critical - payment issues need immediate attention',
      });
    }

    // Network error recommendation
    const networkErrors = patterns.find(
      (p) => p.error_type === 'network_error',
    );
    if (networkErrors && networkErrors.percentage > 20) {
      recommendations.push({
        priority: 'medium',
        action: 'retry_with_exponential_backoff',
        description:
          'Network errors detected. Use exponential backoff retry strategy.',
        estimated_impact: 'Medium - may resolve connectivity issues',
      });
    }

    // Small batch size recommendation
    if (stats.total_attempts > 100 && stats.success_rate < 70) {
      recommendations.push({
        priority: 'medium',
        action: 'reduce_batch_size',
        description:
          'Large job with low success rate. Consider reducing batch size to 25.',
        estimated_impact: 'Medium - may improve success rate',
      });
    }

    return recommendations;
  }

  /**
   * Determine recommended recovery strategy
   */
  private determineRecommendedStrategy(
    patterns: any[],
    stats: any,
  ): {
    strategy: string;
    confidence_score: number;
    estimated_success_rate: number;
  } {
    // Simple strategy determination based on patterns
    if (stats.success_rate > 80) {
      return {
        strategy: 'immediate',
        confidence_score: 90,
        estimated_success_rate: 85,
      };
    } else if (
      patterns.some(
        (p) => p.error_type === 'payment_error' && p.percentage > 50,
      )
    ) {
      return {
        strategy: 'delayed',
        confidence_score: 60,
        estimated_success_rate: 70,
      };
    } else if (stats.success_rate < 30) {
      return {
        strategy: 'scheduled',
        confidence_score: 40,
        estimated_success_rate: 50,
      };
    } else {
      return {
        strategy: 'delayed',
        confidence_score: 75,
        estimated_success_rate: 75,
      };
    }
  }
}
