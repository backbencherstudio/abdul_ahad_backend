import { Controller, Get, Query, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CheckAbilities } from '../../../../ability/abilities.decorator';
import { Action } from '../../../../ability/ability.factory';
import { MigrationJobService } from './migration-job.service';
import { JobAttemptService } from './job-attempt.service';
import { PriceMigrationService } from './price-migration.service';

@ApiTags('Admin - Migration Monitoring Dashboard')
@Controller('admin/subscription/migration/monitoring')
export class MigrationMonitoringController {
  private readonly logger = new Logger(MigrationMonitoringController.name);

  constructor(
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  /**
   * Get comprehensive migration dashboard data
   */
  @Get('dashboard')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get migration dashboard data',
    description:
      'Returns comprehensive data for the migration monitoring dashboard including statistics, active jobs, and recent activity',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved dashboard data',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        dashboard: {
          type: 'object',
          properties: {
            overview: {
              type: 'object',
              properties: {
                total_jobs: { type: 'number' },
                active_jobs: { type: 'number' },
                completed_jobs: { type: 'number' },
                failed_jobs: { type: 'number' },
                success_rate: { type: 'number' },
                total_subscriptions_processed: { type: 'number' },
                total_subscriptions_succeeded: { type: 'number' },
                total_subscriptions_failed: { type: 'number' },
              },
            },
            active_jobs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  plan_id: { type: 'string' },
                  plan_name: { type: 'string' },
                  job_type: { type: 'string' },
                  status: { type: 'string' },
                  progress_percentage: { type: 'number' },
                  started_at: { type: 'string', format: 'date-time' },
                  estimated_completion: { type: 'string', format: 'date-time' },
                  recent_failures: { type: 'number' },
                },
              },
            },
            recent_activity: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  plan_id: { type: 'string' },
                  plan_name: { type: 'string' },
                  job_type: { type: 'string' },
                  status: { type: 'string' },
                  created_at: { type: 'string', format: 'date-time' },
                  completed_at: { type: 'string', format: 'date-time' },
                  success_count: { type: 'number' },
                  failed_count: { type: 'number' },
                },
              },
            },
            system_health: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['healthy', 'warning', 'critical'],
                },
                active_jobs_count: { type: 'number' },
                failed_jobs_24h: { type: 'number' },
                average_success_rate_24h: { type: 'number' },
                alerts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['info', 'warning', 'error'],
                      },
                      message: { type: 'string' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async getDashboard(@Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested migration dashboard data`,
      );

      // Get overall job statistics
      const jobStats = await this.migrationJobService.getJobStatistics();

      // Get active jobs
      const activeJobs = await this.migrationJobService.getActiveJobs();

      // Calculate system health
      const systemHealth = await this.calculateSystemHealth(
        activeJobs.active_jobs,
      );

      // Get recent activity (last 10 jobs)
      const recentJobs = jobStats.recent_jobs.slice(0, 10);

      // Calculate totals
      const totalSubscriptionsProcessed = jobStats.recent_jobs.reduce(
        (sum, job) => sum + (job.success_count || 0) + (job.failed_count || 0),
        0,
      );
      const totalSubscriptionsSucceeded = jobStats.recent_jobs.reduce(
        (sum, job) => sum + (job.success_count || 0),
        0,
      );
      const totalSubscriptionsFailed = jobStats.recent_jobs.reduce(
        (sum, job) => sum + (job.failed_count || 0),
        0,
      );

      // Enhance active jobs with estimated completion times
      const enhancedActiveJobs = await Promise.all(
        activeJobs.active_jobs.map(async (job) => {
          const estimatedCompletion = await this.estimateJobCompletion(job);
          return {
            ...job,
            estimated_completion: estimatedCompletion,
          };
        }),
      );

      const dashboard = {
        overview: {
          total_jobs: jobStats.statistics.total_jobs,
          active_jobs:
            jobStats.statistics.running_jobs + jobStats.statistics.pending_jobs,
          completed_jobs: jobStats.statistics.completed_jobs,
          failed_jobs: jobStats.statistics.failed_jobs,
          success_rate: jobStats.statistics.success_rate,
          total_subscriptions_processed: totalSubscriptionsProcessed,
          total_subscriptions_succeeded: totalSubscriptionsSucceeded,
          total_subscriptions_failed: totalSubscriptionsFailed,
        },
        active_jobs: enhancedActiveJobs,
        recent_activity: recentJobs,
        system_health: systemHealth,
      };

      this.logger.log(
        `Retrieved dashboard data: ${dashboard.overview.active_jobs} active jobs, ` +
          `${dashboard.overview.success_rate}% success rate, ${systemHealth.status} system health`,
      );

      return {
        success: true,
        dashboard,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get migration dashboard data:', error);
      throw error;
    }
  }

  /**
   * Get real-time job progress updates
   */
  @Get('progress/:jobId')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get real-time job progress',
    description:
      'Returns real-time progress information for a specific migration job',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved job progress',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        job_id: { type: 'string' },
        progress: {
          type: 'object',
          properties: {
            current_step: { type: 'string' },
            total_steps: { type: 'number' },
            completed_steps: { type: 'number' },
            progress_percentage: { type: 'number' },
            estimated_completion: { type: 'string', format: 'date-time' },
            current_speed: { type: 'number' }, // subscriptions per minute
            recent_activity: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string', format: 'date-time' },
                  action: { type: 'string' },
                  subscription_id: { type: 'string' },
                  success: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  })
  async getJobProgress(@Query('jobId') jobId: string, @Req() req) {
    try {
      this.logger.log(
        `Admin ${req.user?.email || 'unknown'} requested progress for job ${jobId}`,
      );

      const jobDetails = await this.migrationJobService.getJobDetails(jobId);
      const attemptStats =
        await this.jobAttemptService.getAttemptStatistics(jobId);

      // Calculate current speed (subscriptions processed per minute)
      const currentSpeed = await this.calculateCurrentSpeed(jobId);

      // Get recent activity (last 10 attempts)
      const recentAttempts = jobDetails.attempts
        .slice(0, 10)
        .map((attempt) => ({
          timestamp: attempt.created_at,
          action: attempt.success ? 'completed' : 'failed',
          subscription_id: attempt.subscription_id,
          success: attempt.success,
        }));

      const progress = {
        current_step: this.determineCurrentStep(
          jobDetails.job.status,
          jobDetails.job.job_type,
        ),
        total_steps: jobDetails.job.total_count,
        completed_steps:
          jobDetails.job.success_count + jobDetails.job.failed_count,
        progress_percentage: jobDetails.job.progress_percentage,
        estimated_completion: await this.estimateJobCompletion(jobDetails.job),
        current_speed: currentSpeed,
        recent_activity: recentAttempts,
      };

      this.logger.log(
        `Retrieved progress for job ${jobId}: ${progress.progress_percentage}% complete, ` +
          `${progress.current_speed} subscriptions/minute`,
      );

      return {
        success: true,
        job_id: jobId,
        progress,
        updated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to get job progress for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get migration alerts and warnings
   */
  @Get('alerts')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  @ApiOperation({
    summary: 'Get migration alerts',
    description:
      'Returns current alerts, warnings, and issues related to migration jobs',
  })
  @ApiQuery({
    name: 'severity',
    required: false,
    description: 'Filter alerts by severity (info, warning, error)',
    enum: ['info', 'warning', 'error'],
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved migration alerts',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        alerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['info', 'warning', 'error'] },
              title: { type: 'string' },
              message: { type: 'string' },
              job_id: { type: 'string' },
              plan_id: { type: 'string' },
              plan_name: { type: 'string' },
              created_at: { type: 'string', format: 'date-time' },
              resolved: { type: 'boolean' },
              resolved_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        summary: {
          type: 'object',
          properties: {
            total_alerts: { type: 'number' },
            error_alerts: { type: 'number' },
            warning_alerts: { type: 'number' },
            info_alerts: { type: 'number' },
            unresolved_alerts: { type: 'number' },
          },
        },
      },
    },
  })
  async getMigrationAlerts(
    @Query('severity') severity?: string,
    @Req() req?: any,
  ) {
    try {
      this.logger.log(
        `Admin ${req?.user?.email || 'unknown'} requested migration alerts${severity ? ` (severity: ${severity})` : ''}`,
      );

      // Get all active jobs to check for issues
      const activeJobs = await this.migrationJobService.getActiveJobs();

      // Generate alerts based on job status and performance
      const alerts = await this.generateMigrationAlerts(activeJobs.active_jobs);

      // Filter by severity if specified
      const filteredAlerts = severity
        ? alerts.filter((alert) => alert.type === severity)
        : alerts;

      // Calculate summary
      const summary = {
        total_alerts: alerts.length,
        error_alerts: alerts.filter((a) => a.type === 'error').length,
        warning_alerts: alerts.filter((a) => a.type === 'warning').length,
        info_alerts: alerts.filter((a) => a.type === 'info').length,
        unresolved_alerts: alerts.filter((a) => !a.resolved).length,
      };

      this.logger.log(
        `Retrieved ${filteredAlerts.length} migration alerts: ` +
          `${summary.error_alerts} errors, ${summary.warning_alerts} warnings, ${summary.info_alerts} info`,
      );

      return {
        success: true,
        alerts: filteredAlerts,
        summary,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get migration alerts:', error);
      throw error;
    }
  }

  /**
   * Calculate system health based on current job status
   */
  private async calculateSystemHealth(activeJobs: any[]): Promise<any> {
    const now = new Date();
    const alerts: any[] = [];
    let status = 'healthy';

    // Check for stuck jobs (running for more than 2 hours)
    const stuckJobs = activeJobs.filter((job) => {
      if (!job.started_at) return false;
      const runningTime = now.getTime() - new Date(job.started_at).getTime();
      return runningTime > 2 * 60 * 60 * 1000; // 2 hours
    });

    if (stuckJobs.length > 0) {
      status = 'warning';
      alerts.push({
        type: 'warning',
        message: `${stuckJobs.length} job(s) have been running for more than 2 hours`,
        timestamp: now.toISOString(),
      });
    }

    // Check for high failure rates
    const jobsWithHighFailureRate = activeJobs.filter((job) => {
      const totalAttempts = job.success_count + job.failed_count;
      if (totalAttempts === 0) return false;
      const failureRate = job.failed_count / totalAttempts;
      return failureRate > 0.5; // More than 50% failure rate
    });

    if (jobsWithHighFailureRate.length > 0) {
      status = 'critical';
      alerts.push({
        type: 'error',
        message: `${jobsWithHighFailureRate.length} job(s) have high failure rates (>50%)`,
        timestamp: now.toISOString(),
      });
    }

    // Check for too many active jobs
    if (activeJobs.length > 10) {
      status = status === 'critical' ? 'critical' : 'warning';
      alerts.push({
        type: 'warning',
        message: `${activeJobs.length} jobs are currently active (recommended: <10)`,
        timestamp: now.toISOString(),
      });
    }

    return {
      status,
      active_jobs_count: activeJobs.length,
      failed_jobs_24h: 0, // Would need to query for this
      average_success_rate_24h: 0, // Would need to query for this
      alerts,
    };
  }

  /**
   * Estimate job completion time
   */
  private async estimateJobCompletion(job: any): Promise<string | null> {
    if (!job.started_at || job.status === 'COMPLETED') {
      return null;
    }

    const now = new Date();
    const startTime = new Date(job.started_at);
    const elapsed = now.getTime() - startTime.getTime();

    const processed = job.success_count + job.failed_count;
    if (processed === 0) {
      return null;
    }

    const rate = processed / (elapsed / 60000); // per minute
    const remaining = job.total_count - processed;
    const estimatedMinutes = remaining / rate;

    const estimatedCompletion = new Date(
      now.getTime() + estimatedMinutes * 60000,
    );
    return estimatedCompletion.toISOString();
  }

  /**
   * Calculate current processing speed
   */
  private async calculateCurrentSpeed(jobId: string): Promise<number> {
    // This would typically query recent attempts and calculate rate
    // For now, return a placeholder
    return 0;
  }

  /**
   * Determine current step description
   */
  private determineCurrentStep(status: string, jobType: string): string {
    switch (status) {
      case 'PENDING':
        return 'Waiting to start';
      case 'RUNNING':
        return jobType === 'NOTICE'
          ? 'Sending notices'
          : 'Migrating subscriptions';
      case 'COMPLETED':
        return 'Completed successfully';
      case 'FAILED':
        return 'Failed with errors';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Unknown status';
    }
  }

  /**
   * Generate migration alerts based on job status
   */
  private async generateMigrationAlerts(activeJobs: any[]): Promise<any[]> {
    const alerts: any[] = [];
    const now = new Date();

    for (const job of activeJobs) {
      // Check for stuck jobs
      if (job.started_at) {
        const runningTime = now.getTime() - new Date(job.started_at).getTime();
        if (runningTime > 2 * 60 * 60 * 1000) {
          // 2 hours
          alerts.push({
            id: `stuck-job-${job.id}`,
            type: 'warning',
            title: 'Job Running Too Long',
            message: `Job ${job.id} has been running for ${Math.round(runningTime / 60000)} minutes`,
            job_id: job.id,
            plan_id: job.plan_id,
            plan_name: job.plan_name,
            created_at: new Date(
              job.started_at.getTime() + 2 * 60 * 60 * 1000,
            ).toISOString(),
            resolved: false,
          });
        }
      }

      // Check for high failure rates
      const totalAttempts = job.success_count + job.failed_count;
      if (totalAttempts > 10) {
        // Only check if we have enough data
        const failureRate = job.failed_count / totalAttempts;
        if (failureRate > 0.3) {
          // More than 30% failure rate
          alerts.push({
            id: `high-failure-rate-${job.id}`,
            type: 'error',
            title: 'High Failure Rate',
            message: `Job ${job.id} has a ${Math.round(failureRate * 100)}% failure rate`,
            job_id: job.id,
            plan_id: job.plan_id,
            plan_name: job.plan_name,
            created_at: now.toISOString(),
            resolved: false,
          });
        }
      }
    }

    return alerts;
  }
}
