import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MigrationJobService } from './migration-job.service';
import { JobAttemptService } from './job-attempt.service';
import { PriceMigrationService } from './price-migration.service';

@Injectable()
export class MigrationErrorHandlerService {
  private readonly logger = new Logger(MigrationErrorHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  /**
   * Get all failed migration jobs that can be retried
   */
  async getFailedJobsForRetry(): Promise<any> {
    try {
      this.logger.log('Retrieving failed migration jobs for retry analysis');

      const failedJobs = await this.prisma.migrationJob.findMany({
        where: {
          status: 'FAILED',
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        include: {
          attempts: {
            where: {
              success: false,
            },
            orderBy: {
              created_at: 'desc',
            },
            take: 5, // Get last 5 failed attempts
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        take: 20,
      });

      // Enhance with retry recommendations
      const enhancedJobs = failedJobs.map((job) => ({
        ...job,
        retry_recommendation: this.getRetryRecommendation(job),
        can_retry: this.canJobBeRetried(job),
        estimated_retry_time: this.estimateRetryTime(job),
      }));

      this.logger.log(
        `Found ${enhancedJobs.length} failed jobs for retry analysis`,
      );

      return {
        success: true,
        failed_jobs: enhancedJobs,
        total_count: enhancedJobs.length,
        retryable_count: enhancedJobs.filter((job) => job.can_retry).length,
      };
    } catch (error) {
      this.logger.error('Failed to get failed jobs for retry:', error);
      throw error;
    }
  }

  /**
   * Retry a failed migration job
   */
  async retryFailedJob(
    jobId: string,
    options?: { force?: boolean },
  ): Promise<any> {
    try {
      this.logger.log(`Retrying failed migration job: ${jobId}`);

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

      if (!options?.force && !this.canJobBeRetried(job)) {
        throw new Error(
          `Job ${jobId} cannot be retried: ${this.getRetryRecommendation(job)}`,
        );
      }

      // Reset job status to PENDING
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

      this.logger.log(`Successfully reset job ${jobId} for retry`);

      return {
        success: true,
        message: `Job ${jobId} has been reset and is ready for retry`,
        job_id: jobId,
        retry_recommendation: this.getRetryRecommendation(job),
      };
    } catch (error) {
      this.logger.error(`Failed to retry job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed error analysis for a specific job
   */
  async getJobErrorAnalysis(jobId: string): Promise<any> {
    try {
      this.logger.log(`Getting error analysis for job: ${jobId}`);

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

      // Analyze error patterns
      const errorAnalysis = this.analyzeErrorPatterns(job.attempts);
      const retryRecommendation = this.getRetryRecommendation(job);
      const canRetry = this.canJobBeRetried(job);

      this.logger.log(`Generated error analysis for job ${jobId}`);

      return {
        success: true,
        job_id: jobId,
        error_analysis: errorAnalysis,
        retry_recommendation: retryRecommendation,
        can_retry: canRetry,
        estimated_retry_time: this.estimateRetryTime(job),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get error analysis for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get system-wide error summary
   */
  async getSystemErrorSummary(): Promise<any> {
    try {
      this.logger.log('Generating system-wide error summary');

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Get error statistics
      const [recentErrors, commonErrors, errorTrends] = await Promise.all([
        this.getRecentErrorStats(last24Hours),
        this.getCommonErrorPatterns(last7Days),
        this.getErrorTrends(last7Days),
      ]);

      const summary = {
        recent_errors: recentErrors,
        common_errors: commonErrors,
        error_trends: errorTrends,
        system_health: this.calculateSystemHealth(recentErrors, commonErrors),
      };

      this.logger.log('Generated system-wide error summary');

      return {
        success: true,
        summary,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get system error summary:', error);
      throw error;
    }
  }

  /**
   * Determine if a job can be retried
   */
  private canJobBeRetried(job: any): boolean {
    // Don't retry if job is too old (more than 7 days)
    const jobAge = Date.now() - new Date(job.created_at).getTime();
    if (jobAge > 7 * 24 * 60 * 60 * 1000) {
      return false;
    }

    // Don't retry if job has too many failed attempts (more than 5)
    if (job.attempts.length >= 5) {
      return false;
    }

    // Don't retry if job type is NOTICE (notices should only be sent once)
    if (job.job_type === 'NOTICE') {
      return false;
    }

    return true;
  }

  /**
   * Get retry recommendation for a job
   */
  private getRetryRecommendation(job: any): string {
    if (!this.canJobBeRetried(job)) {
      if (job.job_type === 'NOTICE') {
        return 'Notices cannot be retried. Create a new notice job instead.';
      }
      if (job.attempts.length >= 5) {
        return 'Too many failed attempts. Manual intervention required.';
      }
      if (
        Date.now() - new Date(job.created_at).getTime() >
        7 * 24 * 60 * 60 * 1000
      ) {
        return 'Job is too old. Create a new migration job instead.';
      }
    }

    return 'Job can be retried. Consider checking system resources and network connectivity.';
  }

  /**
   * Estimate retry time for a job
   */
  private estimateRetryTime(job: any): string {
    const baseTime = 30; // 30 minutes base
    const attemptPenalty = job.attempts.length * 15; // 15 minutes per failed attempt
    const estimatedMinutes = baseTime + attemptPenalty;

    const retryTime = new Date(Date.now() + estimatedMinutes * 60 * 1000);
    return retryTime.toISOString();
  }

  /**
   * Analyze error patterns from failed attempts
   */
  private analyzeErrorPatterns(attempts: any[]): any {
    if (attempts.length === 0) {
      return {
        error_count: 0,
        common_errors: [],
        error_patterns: [],
        recommendations: [],
      };
    }

    // Group errors by type
    const errorGroups = attempts.reduce((groups, attempt) => {
      const errorType = this.categorizeError(attempt.error_message);
      if (!groups[errorType]) {
        groups[errorType] = [];
      }
      groups[errorType].push(attempt);
      return groups;
    }, {});

    // Find common errors
    const commonErrors = Object.entries(errorGroups)
      .map(([type, attempts]) => ({
        error_type: type,
        count: (attempts as any[]).length,
        percentage:
          ((attempts as any[]).length / (attempts as any[]).length) * 100,
        sample_message:
          (attempts as any[])[0]?.error_message || 'No error message',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Generate recommendations
    const recommendations = this.generateErrorRecommendations(errorGroups);

    return {
      error_count: attempts.length,
      common_errors: commonErrors,
      error_patterns: Object.keys(errorGroups),
      recommendations,
    };
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

  /**
   * Generate recommendations based on error patterns
   */
  private generateErrorRecommendations(errorGroups: any): string[] {
    const recommendations: string[] = [];

    if (errorGroups['Network Error']) {
      recommendations.push('Check network connectivity and server resources');
    }
    if (errorGroups['Database Error']) {
      recommendations.push(
        'Verify database connection and check for constraint violations',
      );
    }
    if (errorGroups['Payment Error']) {
      recommendations.push(
        'Check Stripe API connectivity and API key validity',
      );
    }
    if (errorGroups['Validation Error']) {
      recommendations.push('Review input data and validation rules');
    }
    if (errorGroups['Permission Error']) {
      recommendations.push('Verify API permissions and authentication');
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Review error logs and consider manual intervention',
      );
    }

    return recommendations;
  }

  /**
   * Get recent error statistics
   */
  private async getRecentErrorStats(since: Date): Promise<any> {
    const failedJobs = await this.prisma.migrationJob.count({
      where: {
        status: 'FAILED',
        created_at: { gte: since },
      },
    });

    const failedAttempts = await this.prisma.jobAttempt.count({
      where: {
        success: false,
        created_at: { gte: since },
      },
    });

    return {
      failed_jobs_24h: failedJobs,
      failed_attempts_24h: failedAttempts,
      error_rate_24h: failedJobs > 0 ? failedAttempts / failedJobs : 0,
    };
  }

  /**
   * Get common error patterns
   */
  private async getCommonErrorPatterns(since: Date): Promise<any[]> {
    const failedAttempts = await this.prisma.jobAttempt.findMany({
      where: {
        success: false,
        created_at: { gte: since },
      },
      select: {
        error_message: true,
      },
    });

    const errorGroups = failedAttempts.reduce((groups, attempt) => {
      const errorType = this.categorizeError(attempt.error_message);
      groups[errorType] = (groups[errorType] || 0) + 1;
      return groups;
    }, {});

    return Object.entries(errorGroups)
      .map(([type, count]) => ({
        error_type: type,
        count: count as number,
        percentage: ((count as number) / failedAttempts.length) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Get error trends over time
   */
  private async getErrorTrends(since: Date): Promise<any[]> {
    const dailyErrors = await this.prisma.jobAttempt.groupBy({
      by: ['created_at'],
      where: {
        success: false,
        created_at: { gte: since },
      },
      _count: {
        id: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    return dailyErrors.map((day) => ({
      date: day.created_at.toISOString().split('T')[0],
      error_count: day._count.id,
    }));
  }

  /**
   * Calculate system health based on errors
   */
  private calculateSystemHealth(
    recentErrors: any,
    commonErrors: any[],
  ): string {
    if (recentErrors.failed_jobs_24h > 10) {
      return 'critical';
    }
    if (recentErrors.failed_jobs_24h > 5 || recentErrors.error_rate_24h > 0.5) {
      return 'warning';
    }
    return 'healthy';
  }
}
