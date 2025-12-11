import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StripePayment } from '../../../../common/lib/Payment/stripe/StripePayment';
import { MailService } from '../../../../mail/mail.service';
import { MigrationJobService } from './migration-job.service';
import { JobAttemptService } from './job-attempt.service';
import { AdminNotificationService } from '../../notification/admin-notification.service';
import { NotificationService } from 'src/modules/application/notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

@Injectable()
export class PriceMigrationService {
  private readonly logger = new Logger(PriceMigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly migrationJobService: MigrationJobService,
    private readonly jobAttemptService: JobAttemptService,
    private readonly adminNotificationService: AdminNotificationService,
    private readonly notificationService: NotificationService,
  ) {}

  // Create a new Stripe Price for the plan product and link it
  async createNewPriceVersion(planId: string, newPricePence: number) {
    if (!newPricePence || newPricePence <= 0) {
      throw new BadRequestException('newPricePence must be > 0');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    // Ensure Stripe product exists
    let productId = (plan as any).stripe_product_id as string | null;
    if (!productId) {
      const product = await StripePayment.createProduct({
        name: plan.name,
        active: plan.is_active,
      });
      productId = product.id;
      await this.prisma.subscriptionPlan.update({
        where: { id: planId },
        data: { stripe_product_id: productId },
      });
    }

    // Create a new immutable Stripe Price
    const price = await StripePayment.createPrice({
      unit_amount: newPricePence,
      currency: plan.currency || 'GBP',
      product: productId!,
      recurring_interval: 'month',
      metadata: { plan_id: plan.id },
    });

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        price_pence: newPricePence,
        stripe_price_id: price.id,
        is_legacy_price: true,
        updated_at: new Date(),
      },
    });

    // ✅ FIXED: Mark existing active subscriptions as grandfathered
    const grandfatheredCount = await this.prisma.garageSubscription.updateMany({
      where: {
        plan_id: planId,
        status: 'ACTIVE',
        is_grandfathered: false, // Only update non-grandfathered subscriptions
      },
      data: {
        is_grandfathered: true,
        original_price_pence: plan.price_pence, // Store the old price
        // Keep their current price_pence unchanged (they pay old price)
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      plan_id: updated.id,
      old_price_pence: plan.price_pence,
      new_price_pence: updated.price_pence,
      stripe_price_id: price.id,
      is_legacy_price: updated.is_legacy_price,
      grandfathered_subscriptions: grandfatheredCount.count,
      message: `New price version created successfully. ${grandfatheredCount.count} existing subscribers marked as grandfathered.`,
    };
  }

  // Mark grandfathered subs and schedule migration window with job tracking
  async sendMigrationNotices(planId: string, noticePeriodDays = 30) {
    if (noticePeriodDays < 0.000694) {
      // 1 minute minimum for testing
      throw new BadRequestException(
        'noticePeriodDays must be >= 1 minute (0.000694 days)',
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    this.logger.log(
      `🚀 Starting migration notice campaign for plan ${planId} (${plan.name})`,
    );

    // Create a migration job for tracking
    const job = await this.migrationJobService.createJob({
      plan_id: planId,
      job_type: 'NOTICE',
    });

    try {
      // Start the job
      await this.migrationJobService.startJob(job.job_id);

      const now = new Date();
      const scheduledAt = new Date(
        now.getTime() + noticePeriodDays * 24 * 60 * 60 * 1000,
      );

      // Get subscriptions to process
      const subscriptionsToProcess =
        await this.prisma.garageSubscription.findMany({
          where: {
            plan_id: planId,
            status: 'ACTIVE',
            is_grandfathered: true,
            notice_sent_at: null,
          },
          include: {
            garage: { select: { email: true, garage_name: true } },
          },
        });

      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const errors: string[] = [];

      // Process each subscription with attempt tracking
      for (const sub of subscriptionsToProcess) {
        const attempt = await this.jobAttemptService.createAttempt({
          job_id: job.job_id,
          subscription_id: sub.id,
          garage_id: sub.garage_id,
        });

        try {
          // Update subscription with notice information
          await this.prisma.garageSubscription.update({
            where: { id: sub.id },
            data: {
              notice_sent_at: now,
              migration_scheduled_at: scheduledAt,
              updated_at: now,
            },
          });

          // Send email notification
          const to = sub.garage?.email;
          if (to) {
            const formatGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
            await this.mailService.sendSubscriptionPriceNoticeEmail({
              to,
              garage_name: sub.garage?.garage_name || 'Customer',
              plan_name: plan.name,
              old_price: formatGBP(sub.original_price_pence ?? sub.price_pence),
              new_price: formatGBP(plan.price_pence),
              effective_date: scheduledAt.toDateString(),
              billing_portal_url: `${process.env.APP_URL || 'https://app.local'}/billing`,
            });
          }

          // Mark attempt as successful
          await this.jobAttemptService.updateAttempt(attempt.attempt_id, {
            success: true,
          });

          succeeded++;
          this.logger.log(
            `✅ Notice sent to ${sub.garage?.email} for subscription ${sub.id}`,
          );
        } catch (error) {
          const errorMessage = (error as Error)?.message || 'Unknown error';
          errors.push(`Subscription ${sub.id}: ${errorMessage}`);

          // Mark attempt as failed
          await this.jobAttemptService.updateAttempt(attempt.attempt_id, {
            success: false,
            error_message: errorMessage,
          });

          failed++;
          this.logger.error(
            `❌ Failed to send notice for subscription ${sub.id}:`,
            error,
          );
        }

        processed++;
      }

      // Complete the job
      await this.migrationJobService.completeJob(job.job_id, {
        success: failed === 0,
        processed,
        succeeded,
        failed,
        error_message: errors.length > 0 ? errors.join('; ') : undefined,
      });

      this.logger.log(
        `🏁 Migration notice campaign completed for plan ${planId}: ` +
          `processed=${processed}, succeeded=${succeeded}, failed=${failed}`,
      );

      return {
        success: true,
        job_id: job.job_id,
        affected: succeeded,
        scheduled_for: scheduledAt,
        statistics: {
          total_processed: processed,
          succeeded,
          failed,
          success_rate:
            processed > 0 ? Math.round((succeeded / processed) * 100) : 0,
        },
        message: `Migration notices sent to ${succeeded} grandfathered subscribers. They will be ready for migration on ${scheduledAt.toISOString()}.`,
      };
    } catch (error) {
      // Mark job as failed
      await this.migrationJobService.completeJob(job.job_id, {
        success: false,
        processed: 0,
        succeeded: 0,
        failed: 0,
        error_message: (error as Error)?.message || 'Unknown error',
      });

      this.logger.error(
        `❌ Migration notice campaign failed for plan ${planId}:`,
        error,
      );

      // Notify admins about notice sending failure
      await this.adminNotificationService.notifyNoticeSendingFailed({
        jobId: job.job_id,
        planId: planId,
        planName: plan.name,
        failedCount: 0,
        totalCount: 0,
      });

      throw error;
    }
  }

  // Manual migrate a single subscription – switches Stripe price then updates DB
  async migrateCustomer(
    subscriptionId: string,
    bypassDateCheck: boolean = false,
  ) {
    const sub = await this.prisma.garageSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    if (sub.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only ACTIVE subscriptions can be migrated',
      );
    }
    if (!sub.is_grandfathered) {
      return {
        success: true,
        message: 'Already migrated',
        subscription_id: sub.id,
      };
    }

    // Only check migration date if bypass is not enabled
    if (
      !bypassDateCheck &&
      (!sub.migration_scheduled_at || sub.migration_scheduled_at > new Date())
    ) {
      throw new BadRequestException(
        'Migration is not yet due (notice period not completed)',
      );
    }

    if (!sub.plan?.stripe_price_id) {
      throw new BadRequestException(
        'Plan is not synced to Stripe (missing stripe_price_id)',
      );
    }
    if (!sub.stripe_subscription_id) {
      throw new BadRequestException(
        'No Stripe subscription linked for this customer',
      );
    }

    // Switch the subscription to the new Stripe price
    await StripePayment.updateSubscriptionPrice(
      sub.stripe_subscription_id,
      sub.plan.stripe_price_id,
    );

    const updated = await this.prisma.garageSubscription.update({
      where: { id: sub.id },
      data: {
        original_price_pence: sub.original_price_pence ?? sub.price_pence,
        price_pence: sub.plan.price_pence, // sync to plan’s current price
        is_grandfathered: false,
        updated_at: new Date(),
      },
    });

    // Enqueue confirmation email (best-effort)
    try {
      const g = await this.prisma.user.findUnique({
        where: { id: sub.garage_id },
        select: { email: true, garage_name: true },
      });
      const to = g?.email;
      if (to) {
        const formatGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
        await this.mailService.sendSubscriptionMigrationConfirmationEmail({
          to,
          garage_name: g?.garage_name || 'Customer',
          plan_name: sub.plan.name,
          new_price: formatGBP(updated.price_pence),
          effective_date: new Date().toDateString(),
          next_billing_date: updated.next_billing_date
            ? new Date(updated.next_billing_date).toDateString()
            : 'your usual cycle',
          billing_portal_url: `${process.env.APP_URL || 'https://app.local'}/billing`,
        });

        await this.notificationService.create({
            receiver_id: sub.garage_id,
            type: NotificationType.SUBSCRIPTION,
            text: `Your subscription for the "${sub.plan.name}" plan has been updated to the new price of ${formatGBP(updated.price_pence)}.`,
        });
      }
    } catch {}

    return {
      success: true,
      subscription_id: updated.id,
      new_price_pence: updated.price_pence,
    };
  }

  // Minimal status snapshot for a plan
  async getMigrationStatus(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const [total, grandfathered, noticeSent, readyToMigrate, migrated] =
      await Promise.all([
        this.prisma.garageSubscription.count({ where: { plan_id: planId } }),
        this.prisma.garageSubscription.count({
          where: { plan_id: planId, is_grandfathered: true },
        }),
        this.prisma.garageSubscription.count({
          where: {
            plan_id: planId,
            is_grandfathered: true,
            notice_sent_at: { not: null },
          },
        }),
        this.prisma.garageSubscription.count({
          where: {
            plan_id: planId,
            is_grandfathered: true,
            notice_sent_at: { not: null },
            migration_scheduled_at: { lte: new Date() },
            status: 'ACTIVE',
          },
        }),
        this.prisma.garageSubscription.count({
          where: { plan_id: planId, is_grandfathered: false },
        }),
      ]);

    return {
      success: true,
      plan_id: planId,
      plan_name: plan.name,
      plan_price_pence: plan.price_pence,
      is_legacy_price: plan.is_legacy_price,
      totals: {
        total,
        grandfathered,
        notice_sent: noticeSent,
        ready_to_migrate: readyToMigrate,
        migrated,
      },
    };
  }

  // Bulk migrate a batch of subscriptions that are ready with job tracking
  async bulkMigrateReady(
    planId: string,
    batchSize: number = 50,
    bypassDateCheck: boolean = false,
  ) {
    const now = new Date();

    this.logger.log(
      `🚀 Starting bulk migration for plan ${planId} (batch size: ${batchSize}, bypass: ${bypassDateCheck})`,
    );

    // Create a migration job for tracking
    const job = await this.migrationJobService.createJob({
      plan_id: planId,
      job_type: 'MIGRATION',
    });

    try {
      // Start the job
      await this.migrationJobService.startJob(job.job_id);

      // Build where condition dynamically based on bypass parameter
      const baseCondition = {
        plan_id: planId,
        is_grandfathered: true,
        notice_sent_at: { not: null },
        status: 'ACTIVE' as const,
      };

      const whereCondition = bypassDateCheck
        ? baseCondition // No date restriction for testing
        : { ...baseCondition, migration_scheduled_at: { lte: now } }; // Normal behavior

      const ready = await this.prisma.garageSubscription.findMany({
        where: whereCondition,
        orderBy: { created_at: 'asc' },
        take: batchSize,
        select: { id: true, garage_id: true },
      });

      this.logger.log(
        `📋 Found ${ready.length} subscriptions ready for migration`,
      );

      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const errors: string[] = [];
      const migrated_ids: string[] = [];

      // Process each subscription with attempt tracking
      for (const subscription of ready) {
        const attempt = await this.jobAttemptService.createAttempt({
          job_id: job.job_id,
          subscription_id: subscription.id,
          garage_id: subscription.garage_id,
        });

        try {
          this.logger.log(
            `🔄 Attempting to migrate subscription: ${subscription.id} (bypass: ${bypassDateCheck})`,
          );

          const res = await this.migrateCustomer(
            subscription.id,
            bypassDateCheck,
          );

          if (res?.success) {
            // Mark attempt as successful
            await this.jobAttemptService.updateAttempt(attempt.attempt_id, {
              success: true,
            });

            migrated_ids.push(subscription.id);
            succeeded++;
            this.logger.log(
              `✅ Successfully migrated subscription: ${subscription.id}`,
            );
          } else {
            const errorMessage = 'Migration returned non-success';
            errors.push(`Subscription ${subscription.id}: ${errorMessage}`);

            // Mark attempt as failed
            await this.jobAttemptService.updateAttempt(attempt.attempt_id, {
              success: false,
              error_message: errorMessage,
            });

            failed++;
            this.logger.log(
              `❌ Migration returned non-success for subscription: ${subscription.id}`,
            );
          }
        } catch (error) {
          const errorMessage = (error as Error)?.message || 'Unknown error';
          errors.push(`Subscription ${subscription.id}: ${errorMessage}`);

          // Mark attempt as failed
          await this.jobAttemptService.updateAttempt(attempt.attempt_id, {
            success: false,
            error_message: errorMessage,
          });

          failed++;
          this.logger.error(
            `❌ Migration failed for subscription: ${subscription.id}, reason: ${errorMessage}`,
          );
        }

        processed++;
      }

      // Complete the job
      await this.migrationJobService.completeJob(job.job_id, {
        success: failed === 0,
        processed,
        succeeded,
        failed,
        error_message: errors.length > 0 ? errors.join('; ') : undefined,
      });

      this.logger.log(
        `🏁 Bulk migration completed for plan ${planId}: ` +
          `processed=${processed}, succeeded=${succeeded}, failed=${failed}`,
      );

      // Notify admins about migration completion
      const planData = await this.prisma.subscriptionPlan.findUnique({
        where: { id: planId },
        select: { name: true },
      });

      if (failed > 0) {
        // Notify about failures
        await this.adminNotificationService.notifyMigrationJobFailed({
          jobId: job.job_id,
          planId: planId,
          planName: planData?.name || 'Unknown Plan',
          failedCount: failed,
          totalCount: processed,
          errorMessage: errors.length > 0 ? errors[0] : undefined,
        });
      } else if (succeeded > 0) {
        // Notify about success
        await this.adminNotificationService.notifyMigrationSuccess({
          jobId: job.job_id,
          planId: planId,
          planName: planData?.name || 'Unknown Plan',
          migratedCount: succeeded,
          totalCount: processed,
        });
      }

      return {
        success: true,
        job_id: job.job_id,
        attempted: processed,
        migrated: succeeded,
        failed: failed,
        migrated_ids,
        statistics: {
          total_processed: processed,
          succeeded,
          failed,
          success_rate:
            processed > 0 ? Math.round((succeeded / processed) * 100) : 0,
        },
      };
    } catch (error) {
      // Mark job as failed
      await this.migrationJobService.completeJob(job.job_id, {
        success: false,
        processed: 0,
        succeeded: 0,
        failed: 0,
        error_message: (error as Error)?.message || 'Unknown error',
      });

      this.logger.error(`❌ Bulk migration failed for plan ${planId}:`, error);
      throw error;
    }
  }
}
