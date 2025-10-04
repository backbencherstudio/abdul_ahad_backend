import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MigrationJobService } from './migration-job.service';
import { JobAttemptService } from './job-attempt.service';
import { MigrationErrorHandlerService } from './migration-error-handler.service';

@Injectable()
export class MigrationRetryService {
  private readonly logger = new Logger(MigrationRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly migrationErrorHandlerService: MigrationErrorHandlerService,
  ) {}

  /**
   * Automatic retry mechanism - runs every 30 minutes
   */
  @Cron('0 */30 * * * *') // Every 30 minutes
  async handleAutomaticRetry(): Promise<void> {
    try {
      this.logger.log(
        '🔄 Starting automatic retry check for failed migration jobs',
      );

      // Get failed jobs that can be automatically retried
      const failedJobs = await this.prisma.migrationJob.findMany({
        where: {
          status: 'FAILED',
          created_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours only
          },
        },
        include: {
          attempts: {
            where: { success: false },
            orderBy: { created_at: 'desc' },
            take: 3, // Only check last 3 attempts
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        take: 10, // Process max 10 jobs per run
      });

      this.logger.log(
        `Found ${failedJobs.length} failed jobs to evaluate for retry`,
      );

      let retriedCount = 0;
      let skippedCount = 0;

      for (const job of failedJobs) {
        try {
          // Check if job can be automatically retried
          if (this.canAutoRetry(job)) {
            await this.autoRetryJob(job);
            retriedCount++;
            this.logger.log(`✅ Auto-retried job ${job.id} (${job.job_type})`);
          } else {
            skippedCount++;
            this.logger.log(
              `⏭️ Skipped auto-retry for job ${job.id}: ${this.getSkipReason(job)}`,
            );
          }
        } catch (error) {
          this.logger.error(`❌ Failed to auto-retry job ${job.id}:`, error);
        }
      }

      this.logger.log(
        `🏁 Automatic retry completed: ${retriedCount} retried, ${skippedCount} skipped`,
      );
    } catch (error) {
      this.logger.error('❌ Automatic retry mechanism failed:', error);
    }
  }

  /**
   * Manual retry for specific job with custom options
   */
  async manualRetryJob(
    jobId: string,
    options: {
      max_attempts?: number;
      delay_minutes?: number;
      force?: boolean;
    } = {},
  ): Promise<any> {
    try {
      this.logger.log(
        `Manual retry requested for job ${jobId} with options:`,
        options,
      );

      const job = await this.prisma.migrationJob.findUnique({
        where: { id: jobId },
        include: {
          attempts: {
            where: { success: false },
            orderBy: { created_at: 'desc' },
          },
        },
      });

      if (!job) {
        throw new Error(`Migration job ${jobId} not found`);
      }

      if (job.status !== 'FAILED') {
        throw new Error(
          `Job ${jobId} is not in FAILED status (current: ${job.status})`,
        );
      }

      // Check if job can be retried
      if (!options.force && !this.canManualRetry(job, options)) {
        throw new Error(
          `Job ${jobId} cannot be manually retried: ${this.getManualRetryReason(job, options)}`,
        );
      }

      // Schedule retry with delay if specified
      const retryTime = options.delay_minutes
        ? new Date(Date.now() + options.delay_minutes * 60 * 1000)
        : new Date();

      // Update job with retry information
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: {
          status: 'PENDING',
          error_message: null,
          updated_at: new Date(),
        },
      });

      // Clear failed attempts to start fresh
      await this.prisma.jobAttempt.deleteMany({
        where: {
          job_id: jobId,
          success: false,
        },
      });

      this.logger.log(
        `✅ Successfully scheduled manual retry for job ${jobId} at ${retryTime.toISOString()}`,
      );

      return {
        success: true,
        message: `Job ${jobId} has been scheduled for manual retry`,
        job_id: jobId,
        retry_time: retryTime.toISOString(),
        options_applied: options,
      };
    } catch (error) {
      this.logger.error(`Failed to manually retry job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk retry multiple failed jobs
   */
  async bulkRetryJobs(
    jobIds: string[],
    options: {
      max_attempts?: number;
      delay_minutes?: number;
      force?: boolean;
    } = {},
  ): Promise<any> {
    try {
      this.logger.log(
        `Bulk retry requested for ${jobIds.length} jobs with options:`,
        options,
      );

      const results = {
        successful: [],
        failed: [],
        skipped: [],
      };

      for (const jobId of jobIds) {
        try {
          const result = await this.manualRetryJob(jobId, options);
          results.successful.push({
            job_id: jobId,
            retry_time: result.retry_time,
          });
        } catch (error) {
          results.failed.push({
            job_id: jobId,
            error: error.message,
          });
        }
      }

      this.logger.log(
        `Bulk retry completed: ${results.successful.length} successful, ${results.failed.length} failed, ${results.skipped.length} skipped`,
      );

      return {
        success: true,
        message: `Bulk retry completed for ${jobIds.length} jobs`,
        results,
        summary: {
          total_requested: jobIds.length,
          successful: results.successful.length,
          failed: results.failed.length,
          skipped: results.skipped.length,
        },
      };
    } catch (error) {
      this.logger.error('Failed to bulk retry jobs:', error);
      throw error;
    }
  }

  /**
   * Get retry statistics and health
   */
  async getRetryStatistics(): Promise<any> {
    try {
      this.logger.log('Generating retry statistics');

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [recentRetries, retrySuccessRate, commonRetryErrors, retryTrends] =
        await Promise.all([
          this.getRecentRetryStats(last24Hours),
          this.getRetrySuccessRate(last7Days),
          this.getCommonRetryErrors(last7Days),
          this.getRetryTrends(last7Days),
        ]);

      const statistics = {
        recent_retries: recentRetries,
        retry_success_rate: retrySuccessRate,
        common_retry_errors: commonRetryErrors,
        retry_trends: retryTrends,
        system_health: this.calculateRetryHealth(
          recentRetries,
          retrySuccessRate,
        ),
      };

      this.logger.log('Generated retry statistics');

      return {
        success: true,
        statistics,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get retry statistics:', error);
      throw error;
    }
  }

  /**
   * Check if job can be automatically retried
   */
  private canAutoRetry(job: any): boolean {
    // Don't auto-retry if job is too old (more than 24 hours)
    const jobAge = Date.now() - new Date(job.created_at).getTime();
    if (jobAge > 24 * 60 * 60 * 1000) {
      return false;
    }

    // Don't auto-retry if job has too many failed attempts (more than 3)
    if (job.attempts.length >= 3) {
      return false;
    }

    // Don't auto-retry NOTICE jobs
    if (job.job_type === 'NOTICE') {
      return false;
    }

    // Don't auto-retry if last attempt was less than 30 minutes ago
    if (job.attempts.length > 0) {
      const lastAttempt = new Date(job.attempts[0].created_at);
      const timeSinceLastAttempt = Date.now() - lastAttempt.getTime();
      if (timeSinceLastAttempt < 30 * 60 * 1000) {
        // 30 minutes
        return false;
      }
    }

    return true;
  }

  /**
   * Check if job can be manually retried
   */
  private canManualRetry(job: any, options: any): boolean {
    // Manual retry is more permissive than auto-retry
    const maxAge = options.force
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000; // 7 days if forced, 24 hours otherwise
    const jobAge = Date.now() - new Date(job.created_at).getTime();
    if (jobAge > maxAge) {
      return false;
    }

    const maxAttempts = options.max_attempts || 5;
    if (job.attempts.length >= maxAttempts) {
      return false;
    }

    return true;
  }

  /**
   * Get reason for skipping auto-retry
   */
  private getSkipReason(job: any): string {
    const jobAge = Date.now() - new Date(job.created_at).getTime();
    if (jobAge > 24 * 60 * 60 * 1000) {
      return 'Job too old (more than 24 hours)';
    }
    if (job.attempts.length >= 3) {
      return 'Too many failed attempts (3 or more)';
    }
    if (job.job_type === 'NOTICE') {
      return 'Notice jobs cannot be auto-retried';
    }
    if (job.attempts.length > 0) {
      const lastAttempt = new Date(job.attempts[0].created_at);
      const timeSinceLastAttempt = Date.now() - lastAttempt.getTime();
      if (timeSinceLastAttempt < 30 * 60 * 1000) {
        return 'Last attempt too recent (less than 30 minutes ago)';
      }
    }
    return 'Unknown reason';
  }

  /**
   * Get reason for manual retry failure
   */
  private getManualRetryReason(job: any, options: any): string {
    const maxAge = options.force
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    const jobAge = Date.now() - new Date(job.created_at).getTime();
    if (jobAge > maxAge) {
      return `Job too old (more than ${maxAge / (24 * 60 * 60 * 1000)} days)`;
    }
    const maxAttempts = options.max_attempts || 5;
    if (job.attempts.length >= maxAttempts) {
      return `Too many failed attempts (${maxAttempts} or more)`;
    }
    return 'Unknown reason';
  }

  /**
   * Perform automatic retry for a job
   */
  private async autoRetryJob(job: any): Promise<void> {
    // Reset job status to PENDING
    await this.prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        error_message: null,
        updated_at: new Date(),
      },
    });

    // Clear failed attempts to start fresh
    await this.prisma.jobAttempt.deleteMany({
      where: {
        job_id: job.id,
        success: false,
      },
    });
  }

  /**
   * Get recent retry statistics
   */
  private async getRecentRetryStats(since: Date): Promise<any> {
    const retriedJobs = await this.prisma.migrationJob.count({
      where: {
        status: 'PENDING',
        updated_at: { gte: since },
        created_at: { lt: since }, // Jobs that were retried (updated after creation)
      },
    });

    const successfulRetries = await this.prisma.migrationJob.count({
      where: {
        status: 'COMPLETED',
        updated_at: { gte: since },
        created_at: { lt: since }, // Jobs that were retried and completed
      },
    });

    return {
      retried_jobs_24h: retriedJobs,
      successful_retries_24h: successfulRetries,
      retry_rate_24h: retriedJobs > 0 ? successfulRetries / retriedJobs : 0,
    };
  }

  /**
   * Get retry success rate
   */
  private async getRetrySuccessRate(since: Date): Promise<number> {
    const totalRetries = await this.prisma.migrationJob.count({
      where: {
        updated_at: { gte: since },
        created_at: { lt: since }, // Jobs that were retried
      },
    });

    const successfulRetries = await this.prisma.migrationJob.count({
      where: {
        status: 'COMPLETED',
        updated_at: { gte: since },
        created_at: { lt: since }, // Jobs that were retried and completed
      },
    });

    return totalRetries > 0 ? (successfulRetries / totalRetries) * 100 : 0;
  }

  /**
   * Get common retry errors
   */
  private async getCommonRetryErrors(since: Date): Promise<any[]> {
    const failedRetries = await this.prisma.jobAttempt.findMany({
      where: {
        success: false,
        created_at: { gte: since },
      },
      select: {
        error_message: true,
      },
    });

    const errorGroups = failedRetries.reduce((groups, attempt) => {
      const errorType = this.categorizeError(attempt.error_message);
      groups[errorType] = (groups[errorType] || 0) + 1;
      return groups;
    }, {});

    return Object.entries(errorGroups)
      .map(([type, count]) => ({
        error_type: type,
        count: count as number,
        percentage: ((count as number) / failedRetries.length) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Get retry trends over time
   */
  private async getRetryTrends(since: Date): Promise<any[]> {
    const dailyRetries = await this.prisma.migrationJob.groupBy({
      by: ['updated_at'],
      where: {
        updated_at: { gte: since },
        created_at: { lt: since }, // Jobs that were retried
      },
      _count: {
        id: true,
      },
      orderBy: {
        updated_at: 'asc',
      },
    });

    return dailyRetries.map((day) => ({
      date: day.updated_at.toISOString().split('T')[0],
      retry_count: day._count.id,
    }));
  }

  /**
   * Calculate retry system health
   */
  private calculateRetryHealth(
    recentRetries: any,
    retrySuccessRate: number,
  ): string {
    if (recentRetries.retry_rate_24h < 0.3) {
      // Less than 30% success rate
      return 'critical';
    }
    if (recentRetries.retry_rate_24h < 0.6 || retrySuccessRate < 50) {
      // Less than 60% success rate or 50% overall
      return 'warning';
    }
    return 'healthy';
  }

  /**
   * Categorize error message into error types
   */
  private categorizeError(errorMessage: string): string {
    if (!errorMessage) return 'Unknown Error';

    const message = errorMessage.toLowerCase();

    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection')
    ) {
      return 'Network Error';
    }
    if (
      message.includes('database') ||
      message.includes('prisma') ||
      message.includes('constraint')
    ) {
      return 'Database Error';
    }
    if (
      message.includes('stripe') ||
      message.includes('payment') ||
      message.includes('billing')
    ) {
      return 'Payment Error';
    }
    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('missing')
    ) {
      return 'Validation Error';
    }
    if (
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    ) {
      return 'Permission Error';
    }

    return 'Other Error';
  }
}
