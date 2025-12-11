import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MigrationJobStatus } from '@prisma/client';
import { AdminNotificationService } from '../../notification/admin-notification.service';

export interface CreateMigrationJobDto {
  plan_id: string;
  job_type: 'NOTICE' | 'MIGRATION';
  total_count?: number;
}

export interface JobExecutionResult {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  error_message?: string;
}

@Injectable()
export class MigrationJobService {
  private readonly logger = new Logger(MigrationJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminNotificationService: AdminNotificationService,
  ) {}

  /**
   * Create a new migration job
   * Used when starting notice campaigns or bulk migrations
   */
  async createJob(dto: CreateMigrationJobDto): Promise<any> {
    try {
      this.logger.log(
        `Creating migration job for plan ${dto.plan_id}, type: ${dto.job_type}`,
      );

      // Validate plan exists
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: dto.plan_id },
        select: { id: true, name: true },
      });

      if (!plan) {
        throw new NotFoundException(`Plan with ID ${dto.plan_id} not found`);
      }

      // Count total subscriptions to process
      let totalCount = dto.total_count;
      if (!totalCount) {
        if (dto.job_type === 'NOTICE') {
          // Count grandfathered subscriptions that haven't received notices
          totalCount = await this.prisma.garageSubscription.count({
            where: {
              plan_id: dto.plan_id,
              is_grandfathered: true,
              notice_sent_at: null,
              status: 'ACTIVE',
            },
          });
        } else {
          // Count ready-to-migrate subscriptions
          totalCount = await this.prisma.garageSubscription.count({
            where: {
              plan_id: dto.plan_id,
              is_grandfathered: true,
              notice_sent_at: { not: null },
              migration_scheduled_at: { lte: new Date() },
              status: 'ACTIVE',
            },
          });
        }
      }

      const job = await this.prisma.migrationJob.create({
        data: {
          plan_id: dto.plan_id,
          job_type: dto.job_type,
          status: MigrationJobStatus.PENDING,
          total_count: totalCount,
          success_count: 0,
          failed_count: 0,
        },
      });

      this.logger.log(
        `✅ Created migration job ${job.id} for plan ${dto.plan_id} (${totalCount} subscriptions)`,
      );

      return {
        success: true,
        job_id: job.id,
        plan_id: dto.plan_id,
        job_type: dto.job_type,
        total_count: totalCount,
        status: job.status,
        created_at: job.created_at,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create migration job for plan ${dto.plan_id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Start job execution - mark as RUNNING and record start time
   */
  async startJob(jobId: string): Promise<void> {
    try {
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: {
          status: MigrationJobStatus.RUNNING,
          started_at: new Date(),
        },
      });

      this.logger.log(`🚀 Started migration job ${jobId}`);
    } catch (error) {
      this.logger.error(`Failed to start migration job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Complete job execution - mark as COMPLETED and record completion time
   */
  async completeJob(jobId: string, result: JobExecutionResult): Promise<void> {
    try {
      const updateData: any = {
        status: result.success
          ? MigrationJobStatus.COMPLETED
          : MigrationJobStatus.FAILED,
        completed_at: new Date(),
        success_count: result.succeeded,
        failed_count: result.failed,
      };

      if (!result.success && result.error_message) {
        updateData.error_message = result.error_message;
      }

      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: updateData,
      });

      this.logger.log(
        `🏁 Completed migration job ${jobId}: ${result.success ? 'SUCCESS' : 'FAILED'} ` +
          `(processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed})`,
      );
    } catch (error) {
      this.logger.error(`Failed to complete migration job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a running or pending job
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const job = await this.prisma.migrationJob.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        throw new NotFoundException(`Migration job ${jobId} not found`);
      }

      if (job.status === MigrationJobStatus.COMPLETED) {
        throw new BadRequestException('Cannot cancel a completed job');
      }

      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: job.plan_id },
      });

      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: {
          status: MigrationJobStatus.CANCELLED,
          completed_at: new Date(),
        },
      });

      this.logger.log(`🛑 Cancelled migration job ${jobId}`);

      try {
        await this.adminNotificationService.sendToAllAdmins({
          type: 'migration',
          title: 'Migration Job Cancelled',
          message: `Migration job for plan "${plan?.name || 'Unknown Plan'}" was cancelled. ${job.success_count} subscriptions were migrated before cancellation.`,
          metadata: {
            job_id: jobId,
            plan_id: job.plan_id,
            plan_name: plan?.name || 'Unknown Plan',
            migrated_before_cancel: job.success_count,
          },
        });
      } catch (notificationError) {
        this.logger.error(
          'Failed to send migration job cancelled notification:',
          notificationError,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to cancel migration job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get job details with attempt history
   */
  async getJobDetails(jobId: string): Promise<any> {
    try {
      const job = await this.prisma.migrationJob.findUnique({
        where: { id: jobId },
        include: {
          attempts: {
            orderBy: { created_at: 'desc' },
            take: 100, // Limit to recent attempts
          },
        },
      });

      if (!job) {
        throw new NotFoundException(`Migration job ${jobId} not found`);
      }

      // Get plan details
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: job.plan_id },
        select: { id: true, name: true, price_pence: true, currency: true },
      });

      return {
        success: true,
        job: {
          id: job.id,
          plan_id: job.plan_id,
          plan_name: plan?.name || 'Unknown Plan',
          plan_price: plan
            ? this.formatPrice(plan.price_pence, plan.currency)
            : 'Unknown',
          job_type: job.job_type,
          status: job.status,
          created_at: job.created_at,
          started_at: job.started_at,
          completed_at: job.completed_at,
          total_count: job.total_count,
          success_count: job.success_count,
          failed_count: job.failed_count,
          error_message: job.error_message,
          progress_percentage:
            job.total_count > 0
              ? Math.round(
                  ((job.success_count + job.failed_count) / job.total_count) *
                    100,
                )
              : 0,
        },
        attempts: job.attempts.map((attempt) => ({
          id: attempt.id,
          subscription_id: attempt.subscription_id,
          garage_id: attempt.garage_id,
          success: attempt.success,
          error_message: attempt.error_message,
          attempt_number: attempt.attempt_number,
          retry_after: attempt.retry_after,
          created_at: attempt.created_at,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get job details for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get all migration jobs with optional filtering
   */
  async getJobs(filters: {
    status?: string;
    plan_id?: string;
    job_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    try {
      this.logger.log('Retrieving migration jobs with filters:', filters);

      const where: any = {};

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.plan_id) {
        where.plan_id = filters.plan_id;
      }

      if (filters.job_type) {
        where.job_type = filters.job_type;
      }

      const [jobs, total] = await Promise.all([
        this.prisma.migrationJob.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: filters.limit || 20,
          skip: filters.offset || 0,
        }),
        this.prisma.migrationJob.count({ where }),
      ]);

      // Get plan names for the jobs
      const planIds = [...new Set(jobs.map((job) => job.plan_id))];
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, name: true },
      });

      const planMap = new Map(plans.map((plan) => [plan.id, plan.name]));

      const formattedJobs = jobs.map((job) => ({
        id: job.id,
        plan_id: job.plan_id,
        plan_name: planMap.get(job.plan_id) || 'Unknown Plan',
        job_type: job.job_type,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        total_count: job.total_count,
        success_count: job.success_count,
        failed_count: job.failed_count,
        progress_percentage:
          job.total_count > 0
            ? Math.round(
                ((job.success_count + job.failed_count) / job.total_count) *
                  100,
              )
            : 0,
      }));

      this.logger.log(
        `Retrieved ${formattedJobs.length} migration jobs (total: ${total})`,
      );

      return {
        success: true,
        jobs: formattedJobs,
        pagination: {
          total,
          limit: filters.limit || 20,
          offset: filters.offset || 0,
          has_more: (filters.offset || 0) + (filters.limit || 20) < total,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get migration jobs:', error);
      throw error;
    }
  }

  /**
   * Get all jobs for a specific plan
   */
  async getJobsByPlan(planId: string, limit: number = 20): Promise<any> {
    try {
      const jobs = await this.prisma.migrationJob.findMany({
        where: { plan_id: planId },
        orderBy: { created_at: 'desc' },
        take: limit,
      });

      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: planId },
        select: { id: true, name: true },
      });

      return {
        success: true,
        plan_id: planId,
        plan_name: plan?.name || 'Unknown Plan',
        jobs: jobs.map((job) => ({
          id: job.id,
          job_type: job.job_type,
          status: job.status,
          created_at: job.created_at,
          started_at: job.started_at,
          completed_at: job.completed_at,
          total_count: job.total_count,
          success_count: job.success_count,
          failed_count: job.failed_count,
          progress_percentage:
            job.total_count > 0
              ? Math.round(
                  ((job.success_count + job.failed_count) / job.total_count) *
                    100,
                )
              : 0,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get jobs for plan ${planId}:`, error);
      throw error;
    }
  }

  /**
   * Get all active/running jobs across all plans
   */
  async getActiveJobs(): Promise<any> {
    try {
      const activeJobs = await this.prisma.migrationJob.findMany({
        where: {
          status: {
            in: [MigrationJobStatus.PENDING, MigrationJobStatus.RUNNING],
          },
        },
        include: {
          attempts: {
            where: { success: false },
            orderBy: { created_at: 'desc' },
            take: 5, // Recent failed attempts
          },
        },
        orderBy: { created_at: 'desc' },
      });

      // Get plan details for each job
      const planIds = [...new Set(activeJobs.map((job) => job.plan_id))];
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, name: true },
      });

      const planMap = new Map(plans.map((plan) => [plan.id, plan]));

      return {
        success: true,
        active_jobs: activeJobs.map((job) => ({
          id: job.id,
          plan_id: job.plan_id,
          plan_name: planMap.get(job.plan_id)?.name || 'Unknown Plan',
          job_type: job.job_type,
          status: job.status,
          created_at: job.created_at,
          started_at: job.started_at,
          total_count: job.total_count,
          success_count: job.success_count,
          failed_count: job.failed_count,
          progress_percentage:
            job.total_count > 0
              ? Math.round(
                  ((job.success_count + job.failed_count) / job.total_count) *
                    100,
                )
              : 0,
          recent_failures: job.attempts.length,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get active jobs:', error);
      throw error;
    }
  }

  /**
   * Get job statistics for dashboard
   */
  async getJobStatistics(planId?: string): Promise<any> {
    try {
      const whereClause = planId ? { plan_id: planId } : {};

      const [
        totalJobs,
        completedJobs,
        failedJobs,
        runningJobs,
        pendingJobs,
        recentJobs,
      ] = await Promise.all([
        this.prisma.migrationJob.count({ where: whereClause }),
        this.prisma.migrationJob.count({
          where: { ...whereClause, status: MigrationJobStatus.COMPLETED },
        }),
        this.prisma.migrationJob.count({
          where: { ...whereClause, status: MigrationJobStatus.FAILED },
        }),
        this.prisma.migrationJob.count({
          where: { ...whereClause, status: MigrationJobStatus.RUNNING },
        }),
        this.prisma.migrationJob.count({
          where: { ...whereClause, status: MigrationJobStatus.PENDING },
        }),
        this.prisma.migrationJob.findMany({
          where: whereClause,
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            plan_id: true,
            job_type: true,
            status: true,
            created_at: true,
            completed_at: true,
            success_count: true,
            failed_count: true,
          },
        }),
      ]);

      return {
        success: true,
        statistics: {
          total_jobs: totalJobs,
          completed_jobs: completedJobs,
          failed_jobs: failedJobs,
          running_jobs: runningJobs,
          pending_jobs: pendingJobs,
          success_rate:
            totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0,
        },
        recent_jobs: recentJobs,
      };
    } catch (error) {
      this.logger.error('Failed to get job statistics:', error);
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
