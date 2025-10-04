import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { CheckAbilities } from '../../../../ability/abilities.decorator';
import { Action } from '../../../../ability/ability.factory';
import { MigrationErrorHandlerService } from './migration-error-handler.service';

@ApiTags('Admin - Migration Error Recovery')
@Controller('admin/subscription/migration/errors')
export class MigrationErrorRecoveryController {
  private readonly logger = new Logger(MigrationErrorRecoveryController.name);

  constructor(
    private readonly migrationErrorHandlerService: MigrationErrorHandlerService,
  ) {}

  /**
   * Get all failed jobs that can be retried
   */
  @Get('failed-jobs')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get failed migration jobs for retry',
    description:
      'Returns all failed migration jobs with retry analysis and recommendations',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved failed jobs for retry',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        failed_jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              plan_id: { type: 'string' },
              job_type: { type: 'string' },
              status: { type: 'string' },
              error_message: { type: 'string' },
              created_at: { type: 'string', format: 'date-time' },
              retry_recommendation: { type: 'string' },
              can_retry: { type: 'boolean' },
              estimated_retry_time: { type: 'string', format: 'date-time' },
              attempts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    error_message: { type: 'string' },
                    created_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        total_count: { type: 'number' },
        retryable_count: { type: 'number' },
      },
    },
  })
  async getFailedJobsForRetry(@Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested failed jobs for retry`,
      );

      const result =
        await this.migrationErrorHandlerService.getFailedJobsForRetry();

      this.logger.log(
        `Retrieved ${result.failed_jobs.length} failed jobs, ${result.retryable_count} retryable`,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to get failed jobs for retry:', error);
      throw error;
    }
  }

  /**
   * Get detailed error analysis for a specific job
   */
  @Get('analysis/:jobId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get error analysis for specific job',
    description:
      'Returns detailed error analysis and retry recommendations for a specific migration job',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved job error analysis',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        error_analysis: {
          type: 'object',
          properties: {
            error_count: { type: 'number' },
            common_errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  error_type: { type: 'string' },
                  count: { type: 'number' },
                  percentage: { type: 'number' },
                  sample_message: { type: 'string' },
                },
              },
            },
            error_patterns: { type: 'array', items: { type: 'string' } },
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
        retry_recommendation: { type: 'string' },
        can_retry: { type: 'boolean' },
        estimated_retry_time: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getJobErrorAnalysis(@Param('jobId') jobId: string, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested error analysis for job ${jobId}`,
      );

      const result =
        await this.migrationErrorHandlerService.getJobErrorAnalysis(jobId);

      this.logger.log(
        `Generated error analysis for job ${jobId}: ${result.error_analysis.error_count} errors, can retry: ${result.can_retry}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get error analysis for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Retry a failed migration job
   */
  @Post('retry/:jobId')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Retry failed migration job',
    description: 'Resets a failed migration job to PENDING status for retry',
  })
  @ApiParam({ name: 'jobId', description: 'Migration job ID to retry' })
  @ApiBody({
    description: 'Retry options',
    schema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force retry even if job cannot normally be retried',
          default: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully initiated job retry',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        job_id: { type: 'string' },
        retry_recommendation: { type: 'string' },
      },
    },
  })
  async retryFailedJob(
    @Param('jobId') jobId: string,
    @Body() body?: { force?: boolean },
    @Req() req?: any,
  ) {
    try {
      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} initiated retry for job ${jobId} (force: ${body?.force || false})`,
      );

      const result = await this.migrationErrorHandlerService.retryFailedJob(
        jobId,
        {
          force: body?.force || false,
        },
      );

      this.logger.log(
        `Successfully initiated retry for job ${jobId}: ${result.message}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to retry job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get system-wide error summary
   */
  @Get('system-summary')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get system-wide error summary',
    description:
      'Returns comprehensive error statistics and trends across all migration jobs',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved system error summary',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        summary: {
          type: 'object',
          properties: {
            recent_errors: {
              type: 'object',
              properties: {
                failed_jobs_24h: { type: 'number' },
                failed_attempts_24h: { type: 'number' },
                error_rate_24h: { type: 'number' },
              },
            },
            common_errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  error_type: { type: 'string' },
                  count: { type: 'number' },
                  percentage: { type: 'number' },
                },
              },
            },
            error_trends: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string' },
                  error_count: { type: 'number' },
                },
              },
            },
            system_health: {
              type: 'string',
              enum: ['healthy', 'warning', 'critical'],
            },
          },
        },
        generated_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getSystemErrorSummary(@Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested system error summary`,
      );

      const result =
        await this.migrationErrorHandlerService.getSystemErrorSummary();

      this.logger.log(
        `Generated system error summary: ${result.summary.system_health} health, ` +
          `${result.summary.recent_errors.failed_jobs_24h} failed jobs in 24h`,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to get system error summary:', error);
      throw error;
    }
  }

  /**
   * Get error recovery recommendations
   */
  @Get('recommendations')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get error recovery recommendations',
    description:
      'Returns actionable recommendations for resolving common migration errors',
  })
  @ApiQuery({
    name: 'error_type',
    required: false,
    description: 'Filter recommendations by error type',
    enum: [
      'Network Error',
      'Database Error',
      'Payment Error',
      'Validation Error',
      'Permission Error',
      'Other Error',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved error recovery recommendations',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              error_type: { type: 'string' },
              common_causes: { type: 'array', items: { type: 'string' } },
              solutions: { type: 'array', items: { type: 'string' } },
              prevention_tips: { type: 'array', items: { type: 'string' } },
              severity: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
              },
            },
          },
        },
        filtered_by: { type: 'string' },
      },
    },
  })
  async getErrorRecoveryRecommendations(
    @Query('error_type') errorType?: string,
    @Req() req?: any,
  ) {
    try {
      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested error recovery recommendations${errorType ? ` (filter: ${errorType})` : ''}`,
      );

      const recommendations = this.getRecommendationsByErrorType(errorType);

      this.logger.log(
        `Retrieved ${recommendations.length} error recovery recommendations`,
      );

      return {
        success: true,
        recommendations,
        filtered_by: errorType || 'all',
      };
    } catch (error) {
      this.logger.error('Failed to get error recovery recommendations:', error);
      throw error;
    }
  }

  /**
   * Get recommendations by error type
   */
  private getRecommendationsByErrorType(filter?: string): any[] {
    const allRecommendations = [
      {
        error_type: 'Network Error',
        common_causes: [
          'Server overload or high CPU usage',
          'Network connectivity issues',
          'Firewall blocking connections',
          'DNS resolution problems',
        ],
        solutions: [
          'Check server resources and restart if necessary',
          'Verify network connectivity to external APIs',
          'Review firewall rules and allowlist IPs',
          'Test DNS resolution and update if needed',
        ],
        prevention_tips: [
          'Monitor server resources regularly',
          'Implement connection pooling',
          'Use retry mechanisms with exponential backoff',
        ],
        severity: 'medium',
      },
      {
        error_type: 'Database Error',
        common_causes: [
          'Database connection pool exhaustion',
          'Deadlocks or lock timeouts',
          'Constraint violations',
          'Database server overload',
        ],
        solutions: [
          'Increase database connection pool size',
          'Review and optimize database queries',
          'Check for constraint violations in data',
          'Scale database resources if needed',
        ],
        prevention_tips: [
          'Use database connection pooling',
          'Implement proper indexing',
          'Monitor database performance',
        ],
        severity: 'high',
      },
      {
        error_type: 'Payment Error',
        common_causes: [
          'Invalid Stripe API keys',
          'Stripe API rate limiting',
          'Payment method issues',
          'Stripe service outages',
        ],
        solutions: [
          'Verify Stripe API key validity',
          'Implement rate limiting and retry logic',
          'Check payment method status',
          'Monitor Stripe status page',
        ],
        prevention_tips: [
          'Use webhooks for payment status updates',
          'Implement proper error handling',
          'Monitor Stripe API usage',
        ],
        severity: 'critical',
      },
      {
        error_type: 'Validation Error',
        common_causes: [
          'Missing required fields',
          'Invalid data formats',
          'Business rule violations',
          'Data type mismatches',
        ],
        solutions: [
          'Review input data validation rules',
          'Check data format requirements',
          'Verify business logic implementation',
          'Update data types if necessary',
        ],
        prevention_tips: [
          'Implement comprehensive input validation',
          'Use TypeScript for type safety',
          'Write unit tests for validation logic',
        ],
        severity: 'low',
      },
      {
        error_type: 'Permission Error',
        common_causes: [
          'Invalid authentication tokens',
          'Insufficient API permissions',
          'Expired credentials',
          'Role-based access restrictions',
        ],
        solutions: [
          'Verify authentication token validity',
          'Check API permission scopes',
          'Refresh expired credentials',
          'Review role assignments',
        ],
        prevention_tips: [
          'Implement token refresh mechanisms',
          'Monitor credential expiration',
          'Use least privilege principle',
        ],
        severity: 'medium',
      },
    ];

    if (filter) {
      return allRecommendations.filter((rec) => rec.error_type === filter);
    }

    return allRecommendations;
  }
}
