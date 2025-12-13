import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class SubscriptionStatusService {
  private readonly logger = new Logger(SubscriptionStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Check and update subscription statuses (runs daily)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async updateSubscriptionStatuses() {
    this.logger.log('Starting daily subscription status update...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find subscriptions that need status updates
      const subscriptionsToUpdate =
        await this.prisma.garageSubscription.findMany({
          where: {
            status: {
              in: ['ACTIVE', 'PAST_DUE'],
            },
            current_period_end: {
              lte: today,
            },
          },
          include: {
            garage: {
              select: {
                id: true,
                garage_name: true,
                email: true,
              },
            },
            plan: {
              select: {
                name: true,
              },
            },
          },
        });

      this.logger.log(
        `Found ${subscriptionsToUpdate.length} subscriptions to update`,
      );

      for (const subscription of subscriptionsToUpdate) {
        await this.updateSubscriptionStatus(subscription);
      }

      // Add notification for mass expiry warnings
      try {
        const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const expiringSoon = await this.prisma.garageSubscription.count({
          where: {
            status: 'ACTIVE',
            current_period_end: {
              gte: today,
              lte: sevenDaysFromNow,
            },
          },
        });

        if (expiringSoon > 20) {
          // Threshold
          await this.notificationService.sendToAllAdmins({
            type: 'subscription',
            title: 'Mass Subscription Expiry Alert',
            message: `${expiringSoon} subscriptions are expiring in the next 7 days. Consider sending renewal reminders to prevent churn.`,
            metadata: { expiring_count: expiringSoon, days_ahead: 7 },
          });
        }
      } catch (notificationError) {
        this.logger.error(
          'Failed to send mass expiry warning notification:',
          notificationError,
        );
      }

      this.logger.log('Daily subscription status update completed');
    } catch (error) {
      this.logger.error('Error updating subscription statuses:', error);

      // Notify admins about cron failure
      await this.notificationService.notifyCronJobFailed({
        jobName: 'Daily Subscription Status Update',
        errorMessage: error.message || 'Unknown error',
      });
    }
  }

  /**
   * Update individual subscription status
   */
  private async updateSubscriptionStatus(subscription: any) {
    const today = new Date();
    const daysPastDue = Math.floor(
      (today.getTime() - subscription.current_period_end.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    let newStatus: string;
    let updateData: any = {};

    if (daysPastDue <= 0) {
      // Still within grace period
      newStatus = 'ACTIVE';
    } else if (daysPastDue <= 7) {
      // Past due but within grace period
      newStatus = 'PAST_DUE';
    } else {
      // Suspended after grace period
      newStatus = 'SUSPENDED';
      updateData = {
        status: newStatus,
        updated_at: new Date(),
      };

      // Log suspension for admin review
      this.logger.warn(
        `Subscription suspended for garage ${subscription.garage.garage_name} (${subscription.garage.email}) - ${daysPastDue} days past due`,
      );
    }

    if (newStatus !== subscription.status) {
      await this.prisma.garageSubscription.update({
        where: { id: subscription.id },
        data: updateData,
      });

      this.logger.log(
        `Updated subscription ${subscription.id} status from ${subscription.status} to ${newStatus}`,
      );
    }
  }

  /**
   * Check if garage has active subscription
   */
  async isGarageSubscriptionActive(garageId: string): Promise<boolean> {
    const subscription = await this.prisma.garageSubscription.findFirst({
      where: {
        garage_id: garageId,
        status: 'ACTIVE',
        current_period_end: {
          gte: new Date(),
        },
      },
    });

    return !!subscription;
  }

  /**
   * Get subscription status for garage
   */
  async getGarageSubscriptionStatus(garageId: string): Promise<{
    hasActiveSubscription: boolean;
    status?: string;
    expiresAt?: Date;
    daysUntilExpiry?: number;
  }> {
    const subscription = await this.prisma.garageSubscription.findFirst({
      where: {
        garage_id: garageId,
        status: {
          in: ['ACTIVE', 'PAST_DUE', 'SUSPENDED'],
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!subscription) {
      return { hasActiveSubscription: false };
    }

    const today = new Date();
    const daysUntilExpiry = subscription.current_period_end
      ? Math.ceil(
          (subscription.current_period_end.getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      hasActiveSubscription:
        subscription.status === 'ACTIVE' && daysUntilExpiry > 0,
      status: subscription.status,
      expiresAt: subscription.current_period_end,
      daysUntilExpiry: Math.max(0, daysUntilExpiry),
    };
  }

  /**
   * Get subscription health summary for admin
   */
  async getSubscriptionHealthSummary(): Promise<{
    total_subscriptions: number;
    active_subscriptions: number;
    past_due_subscriptions: number;
    suspended_subscriptions: number;
    expiring_soon: number; // within 7 days
    expired_recently: number; // within 7 days
  }> {
    const today = new Date();
    const sevenDaysFromNow = new Date(
      today.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, active, pastDue, suspended, expiringSoon, expiredRecently] =
      await Promise.all([
        this.prisma.garageSubscription.count(),
        this.prisma.garageSubscription.count({ where: { status: 'ACTIVE' } }),
        this.prisma.garageSubscription.count({ where: { status: 'PAST_DUE' } }),
        this.prisma.garageSubscription.count({
          where: { status: 'SUSPENDED' },
        }),
        this.prisma.garageSubscription.count({
          where: {
            status: 'ACTIVE',
            current_period_end: {
              gte: today,
              lte: sevenDaysFromNow,
            },
          },
        }),
        this.prisma.garageSubscription.count({
          where: {
            status: { in: ['PAST_DUE', 'SUSPENDED'] },
            current_period_end: {
              gte: sevenDaysAgo,
              lte: today,
            },
          },
        }),
      ]);

    return {
      total_subscriptions: total,
      active_subscriptions: active,
      past_due_subscriptions: pastDue,
      suspended_subscriptions: suspended,
      expiring_soon: expiringSoon,
      expired_recently: expiredRecently,
    };
  }
}
