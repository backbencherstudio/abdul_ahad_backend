import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

export interface CreateJobAttemptDto {
  job_id: string;
  subscription_id: string;
  garage_id: string;
  attempt_number?: number;
}

export interface UpdateJobAttemptDto {
  success: boolean;
  error_message?: string;
  retry_after?: Date;
}

@Injectable()
export class JobAttemptService {
  private readonly logger = new Logger(JobAttemptService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new job attempt record
   * Called before processing each subscription
   */
  async createAttempt(dto: CreateJobAttemptDto): Promise<any> {
    try {
      // Validate job exists and is in correct state
      const job = await this.prisma.migrationJob.findUnique({
        where: { id: dto.job_id },
      });

      if (!job) {
        throw new NotFoundException(`Migration job ${dto.job_id} not found`);
      }

      if (job.status !== 'RUNNING') {
        throw new BadRequestException(
          `Cannot create attempt for job ${dto.job_id} with status ${job.status}`,
        );
      }

      // Get the next attempt number if not provided
      let attemptNumber = dto.attempt_number || 1;
      if (!dto.attempt_number) {
        const existingAttempts = await this.prisma.jobAttempt.count({
          where: {
            job_id: dto.job_id,
            subscription_id: dto.subscription_id,
          },
        });
        attemptNumber = existingAttempts + 1;
      }

      const attempt = await this.prisma.jobAttempt.create({
        data: {
          job_id: dto.job_id,
          subscription_id: dto.subscription_id,
          garage_id: dto.garage_id,
          attempt_number: attemptNumber,
          success: false, // Will be updated after processing
          error_message: null,
          retry_after: null,
        },
      });

      this.logger.log(
        `📝 Created attempt ${attemptNumber} for subscription ${dto.subscription_id} in job ${dto.job_id}`,
      );

      return {
        success: true,
        attempt_id: attempt.id,
        job_id: dto.job_id,
        subscription_id: dto.subscription_id,
        garage_id: dto.garage_id,
        attempt_number: attemptNumber,
        created_at: attempt.created_at,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create attempt for subscription ${dto.subscription_id} in job ${dto.job_id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update attempt result after processing
   */
  async updateAttempt(
    attemptId: string,
    dto: UpdateJobAttemptDto,
  ): Promise<void> {
    try {
      const attempt = await this.prisma.jobAttempt.findUnique({
        where: { id: attemptId },
      });

      if (!attempt) {
        throw new NotFoundException(`Job attempt ${attemptId} not found`);
      }

      await this.prisma.jobAttempt.update({
        where: { id: attemptId },
        data: {
          success: dto.success,
          error_message: dto.error_message || null,
          retry_after: dto.retry_after || null,
          updated_at: new Date(),
        },
      });

      // Update parent job counters
      await this.updateJobCounters(attempt.job_id);

      const status = dto.success ? 'SUCCESS' : 'FAILED';
      this.logger.log(
        `📊 Updated attempt ${attemptId}: ${status} for subscription ${attempt.subscription_id}`,
      );

      if (!dto.success && dto.error_message) {
        this.logger.warn(
          `❌ Attempt ${attemptId} failed: ${dto.error_message}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to update attempt ${attemptId}:`, error);
      throw error;
    }
  }

  /**
   * Update parent job success/failed counters
   */
  private async updateJobCounters(jobId: string): Promise<void> {
    try {
      const counts = await this.prisma.jobAttempt.groupBy({
        by: ['success'],
        where: { job_id: jobId },
        _count: { success: true },
      });

      const successCount = counts.find((c) => c.success)?._count?.success || 0;
      const failedCount = counts.find((c) => !c.success)?._count?.success || 0;

      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: {
          success_count: successCount,
          failed_count: failedCount,
        },
      });

      this.logger.debug(
        `📈 Updated job ${jobId} counters: ${successCount} succeeded, ${failedCount} failed`,
      );
    } catch (error) {
      this.logger.error(`Failed to update job counters for ${jobId}:`, error);
      // Don't throw - this is a background operation
    }
  }

  /**
   * Get attempt details with subscription info
   */
  async getAttemptDetails(attemptId: string): Promise<any> {
    try {
      const attempt = await this.prisma.jobAttempt.findUnique({
        where: { id: attemptId },
        include: {
          job: {
            select: {
              id: true,
              plan_id: true,
              job_type: true,
              status: true,
            },
          },
        },
      });

      if (!attempt) {
        throw new NotFoundException(`Job attempt ${attemptId} not found`);
      }

      // Get subscription and garage details
      const subscription = await this.prisma.garageSubscription.findUnique({
        where: { id: attempt.subscription_id },
        include: {
          garage: {
            select: {
              id: true,
              email: true,
              garage_name: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
              price_pence: true,
              currency: true,
            },
          },
        },
      });

      // Get plan details for job context
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: attempt.job.plan_id },
        select: { id: true, name: true },
      });

      return {
        success: true,
        attempt: {
          id: attempt.id,
          job_id: attempt.job_id,
          plan_id: attempt.job.plan_id,
          plan_name: plan?.name || 'Unknown Plan',
          job_type: attempt.job.job_type,
          job_status: attempt.job.status,
          subscription_id: attempt.subscription_id,
          garage_id: attempt.garage_id,
          garage_name: subscription?.garage?.garage_name || 'Unknown Garage',
          garage_email: subscription?.garage?.email || 'Unknown Email',
          subscription_plan: subscription?.plan?.name || 'Unknown Plan',
          current_price: subscription?.plan
            ? this.formatPrice(
                subscription.plan.price_pence,
                subscription.plan.currency,
              )
            : 'Unknown',
          attempt_number: attempt.attempt_number,
          success: attempt.success,
          error_message: attempt.error_message,
          retry_after: attempt.retry_after,
          created_at: attempt.created_at,
          updated_at: attempt.updated_at,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get attempt details for ${attemptId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all attempts for a specific job
   */
  async getAttemptsByJob(
    jobId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    try {
      const skip = (page - 1) * limit;

      const [attempts, total] = await Promise.all([
        this.prisma.jobAttempt.findMany({
          where: { job_id: jobId },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' },
          include: {
            job: {
              select: {
                plan_id: true,
                job_type: true,
              },
            },
          },
        }),
        this.prisma.jobAttempt.count({
          where: { job_id: jobId },
        }),
      ]);

      // Get garage details for each attempt
      const garageIds = [...new Set(attempts.map((a) => a.garage_id))];
      const garages = await this.prisma.user.findMany({
        where: { id: { in: garageIds } },
        select: { id: true, garage_name: true, email: true },
      });

      const garageMap = new Map(garages.map((g) => [g.id, g]));

      return {
        success: true,
        job_id: jobId,
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          subscription_id: attempt.subscription_id,
          garage_id: attempt.garage_id,
          garage_name:
            garageMap.get(attempt.garage_id)?.garage_name || 'Unknown',
          garage_email: garageMap.get(attempt.garage_id)?.email || 'Unknown',
          attempt_number: attempt.attempt_number,
          success: attempt.success,
          error_message: attempt.error_message,
          retry_after: attempt.retry_after,
          created_at: attempt.created_at,
          updated_at: attempt.updated_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get attempts for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get failed attempts that need retry
   */
  async getFailedAttemptsForRetry(
    jobId: string,
    maxRetries: number = 3,
  ): Promise<any> {
    try {
      const failedAttempts = await this.prisma.jobAttempt.findMany({
        where: {
          job_id: jobId,
          success: false,
          attempt_number: { lt: maxRetries },
          retry_after: { lte: new Date() },
        },
        orderBy: { created_at: 'asc' },
        take: 100, // Limit batch size for retries
      });

      return {
        success: true,
        job_id: jobId,
        failed_attempts: failedAttempts.map((attempt) => ({
          id: attempt.id,
          subscription_id: attempt.subscription_id,
          garage_id: attempt.garage_id,
          attempt_number: attempt.attempt_number,
          error_message: attempt.error_message,
          retry_after: attempt.retry_after,
          created_at: attempt.created_at,
        })),
        count: failedAttempts.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get failed attempts for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get attempt statistics for a job
   */
  async getAttemptStatistics(jobId: string): Promise<any> {
    try {
      const [
        totalAttempts,
        successfulAttempts,
        failedAttempts,
        retryableAttempts,
      ] = await Promise.all([
        this.prisma.jobAttempt.count({ where: { job_id: jobId } }),
        this.prisma.jobAttempt.count({
          where: { job_id: jobId, success: true },
        }),
        this.prisma.jobAttempt.count({
          where: { job_id: jobId, success: false },
        }),
        this.prisma.jobAttempt.count({
          where: {
            job_id: jobId,
            success: false,
            retry_after: { lte: new Date() },
          },
        }),
      ]);

      return {
        success: true,
        job_id: jobId,
        statistics: {
          total_attempts: totalAttempts,
          successful_attempts: successfulAttempts,
          failed_attempts: failedAttempts,
          retryable_attempts: retryableAttempts,
          success_rate:
            totalAttempts > 0
              ? Math.round((successfulAttempts / totalAttempts) * 100)
              : 0,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get attempt statistics for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clean up old completed attempts (for maintenance)
   */
  async cleanupOldAttempts(
    jobId: string,
    olderThanDays: number = 30,
  ): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const job = await this.prisma.migrationJob.findUnique({
        where: { id: jobId },
      });

      if (!job || job.status !== 'COMPLETED') {
        this.logger.warn(
          `Cannot cleanup attempts for job ${jobId} - job not completed`,
        );
        return;
      }

      const deletedCount = await this.prisma.jobAttempt.deleteMany({
        where: {
          job_id: jobId,
          success: true, // Only cleanup successful attempts
          created_at: { lt: cutoffDate },
        },
      });

      this.logger.log(
        `🧹 Cleaned up ${deletedCount.count} old successful attempts for job ${jobId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cleanup old attempts for job ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Helper method to format price
   */
  private formatPrice(pricePence: number, currency: string = 'GBP'): string {
    const amount = pricePence / 100;

    switch (currency) {
      case 'GBP':
        return `£${amount.toFixed(2)}`;
      case 'USD':
        return `$${amount.toFixed(2)}`;
      case 'EUR':
        return `€${amount.toFixed(2)}`;
      default:
        return `${amount.toFixed(2)} ${currency}`;
    }
  }
}
