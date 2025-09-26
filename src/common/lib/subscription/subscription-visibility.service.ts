import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Service for managing subscription visibility status
 * This service ensures the has_subscription field is properly maintained
 * across all subscription operations
 */
@Injectable()
export class SubscriptionVisibilityService {
  private readonly logger = new Logger(SubscriptionVisibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update user subscription visibility status
   * This method ensures the has_subscription field is properly maintained
   * based on the garage's current subscription status
   *
   * @param garageId - The ID of the garage user
   * @param source - Source of the update (e.g., 'webhook', 'admin', 'garage')
   * @throws Error if database operations fail
   */
  async updateUserSubscriptionStatus(
    garageId: string,
    source: string = 'unknown',
  ): Promise<void> {
    try {
      // Validate garage ID
      if (!garageId || typeof garageId !== 'string') {
        throw new Error(`Invalid garage ID provided: ${garageId}`);
      }

      this.logger.log(
        `🔄 [${source}] Updating subscription status for garage: ${garageId}`,
      );

      // Find the most recent active subscription for this garage
      const activeSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: {
            garage_id: garageId,
            status: {
              in: ['ACTIVE'], // Only ACTIVE subscriptions are visible to drivers
            },
          },
          orderBy: {
            created_at: 'desc',
          },
          include: {
            plan: true,
            garage: {
              select: {
                email: true,
                garage_name: true,
              },
            },
          },
        },
      );

      // Determine subscription status and expiration
      const hasSubscription = !!activeSubscription;
      const subscriptionExpiresAt =
        activeSubscription?.current_period_end || null;
      const garageInfo = activeSubscription?.garage || {
        email: 'Unknown',
        garage_name: 'Unknown',
      };
      const planName = activeSubscription?.plan?.name || 'None';

      // Update user record with subscription status
      await this.prisma.user.update({
        where: { id: garageId },
        data: {
          has_subscription: hasSubscription,
          subscription_expires_at: subscriptionExpiresAt,
        },
      });

      this.logger.log(
        `✅ [${source}] Updated subscription status for garage ${garageId} (${garageInfo.garage_name || garageInfo.email}): ` +
          `has_subscription=${hasSubscription}, expires_at=${subscriptionExpiresAt}, ` +
          `plan=${planName}`,
      );

      // Log driver visibility impact
      if (hasSubscription) {
        this.logger.log(
          `👁️ [${source}] Garage ${garageId} is now VISIBLE to drivers`,
        );
      } else {
        this.logger.log(
          `🚫 [${source}] Garage ${garageId} is now HIDDEN from drivers`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ [${source}] Critical error updating subscription status for garage ${garageId}:`,
        {
          error: error.message,
          stack: error.stack,
          garageId,
          source,
        },
      );

      // Don't re-throw to prevent operation failures
      // Log the error and continue processing
      this.logger.error(
        `⚠️ [${source}] Continuing operation despite subscription status update failure`,
      );
    }
  }

  /**
   * Batch update subscription visibility for multiple garages
   * Useful for bulk operations or data migrations
   *
   * @param garageIds - Array of garage IDs to update
   * @param source - Source of the update
   */
  async batchUpdateUserSubscriptionStatus(
    garageIds: string[],
    source: string = 'batch',
  ): Promise<void> {
    this.logger.log(
      `🔄 [${source}] Batch updating subscription status for ${garageIds.length} garages`,
    );

    const results = await Promise.allSettled(
      garageIds.map((garageId) =>
        this.updateUserSubscriptionStatus(garageId, source),
      ),
    );

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    ).length;
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;

    this.logger.log(
      `✅ [${source}] Batch update completed: ${successful} successful, ${failed} failed`,
    );

    if (failed > 0) {
      this.logger.warn(
        `⚠️ [${source}] ${failed} garages failed to update subscription status`,
      );
    }
  }

  /**
   * Get subscription visibility status for a garage
   *
   * @param garageId - The ID of the garage user
   * @returns Promise<{hasSubscription: boolean, expiresAt: Date | null}>
   */
  async getSubscriptionVisibilityStatus(garageId: string): Promise<{
    hasSubscription: boolean;
    expiresAt: Date | null;
    planName: string | null;
  }> {
    try {
      const activeSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: {
            garage_id: garageId,
            status: {
              in: ['ACTIVE'],
            },
          },
          orderBy: {
            created_at: 'desc',
          },
          include: {
            plan: true,
          },
        },
      );

      return {
        hasSubscription: !!activeSubscription,
        expiresAt: activeSubscription?.current_period_end || null,
        planName: activeSubscription?.plan?.name || null,
      };
    } catch (error) {
      this.logger.error(
        `Error getting subscription visibility status for garage ${garageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Validate subscription visibility consistency
   * Checks if the has_subscription field matches the actual subscription status
   *
   * @param garageId - The ID of the garage user (optional, checks all if not provided)
   * @returns Promise<{consistent: boolean, inconsistencies: Array}>
   */
  async validateSubscriptionVisibilityConsistency(garageId?: string): Promise<{
    consistent: boolean;
    inconsistencies: Array<{
      garageId: string;
      hasSubscription: boolean;
      actualHasActiveSubscription: boolean;
      planName: string | null;
    }>;
  }> {
    try {
      const whereClause = garageId
        ? { id: garageId }
        : { type: 'GARAGE' as any };

      const garages = await this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          has_subscription: true,
          garage_subscriptions: {
            where: {
              status: 'ACTIVE',
            },
            include: {
              plan: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              created_at: 'desc',
            },
            take: 1,
          },
        },
      });

      const inconsistencies = [];

      for (const garage of garages) {
        const actualHasActiveSubscription =
          garage.garage_subscriptions.length > 0;

        if (garage.has_subscription !== actualHasActiveSubscription) {
          inconsistencies.push({
            garageId: garage.id,
            hasSubscription: garage.has_subscription,
            actualHasActiveSubscription,
            planName: garage.garage_subscriptions[0]?.plan?.name || null,
          });
        }
      }

      return {
        consistent: inconsistencies.length === 0,
        inconsistencies,
      };
    } catch (error) {
      this.logger.error(
        'Error validating subscription visibility consistency:',
        error,
      );
      throw error;
    }
  }

  /**
   * Fix subscription visibility inconsistencies
   * Automatically corrects any mismatched has_subscription fields
   *
   * @param garageIds - Optional array of garage IDs to fix (fixes all if not provided)
   * @returns Promise<{fixed: number, errors: Array}>
   */
  async fixSubscriptionVisibilityInconsistencies(
    garageIds?: string[],
  ): Promise<{
    fixed: number;
    errors: Array<{ garageId: string; error: string }>;
  }> {
    try {
      this.logger.log(
        `🔧 Starting subscription visibility consistency fix${garageIds ? ` for ${garageIds.length} garages` : ' for all garages'}`,
      );

      const whereClause = garageIds
        ? { id: { in: garageIds } }
        : { type: 'GARAGE' as any };

      const garages = await this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          has_subscription: true,
          garage_subscriptions: {
            where: {
              status: 'ACTIVE',
            },
            orderBy: {
              created_at: 'desc',
            },
            take: 1,
          },
        },
      });

      let fixed = 0;
      const errors = [];

      for (const garage of garages) {
        try {
          const actualHasActiveSubscription =
            garage.garage_subscriptions.length > 0;

          if (garage.has_subscription !== actualHasActiveSubscription) {
            await this.prisma.user.update({
              where: { id: garage.id },
              data: {
                has_subscription: actualHasActiveSubscription,
                subscription_expires_at: actualHasActiveSubscription
                  ? garage.garage_subscriptions[0]?.current_period_end || null
                  : null,
              },
            });

            this.logger.log(
              `✅ Fixed subscription visibility for garage ${garage.id}: ${garage.has_subscription} → ${actualHasActiveSubscription}`,
            );
            fixed++;
          }
        } catch (error) {
          this.logger.error(`❌ Failed to fix garage ${garage.id}:`, error);
          errors.push({
            garageId: garage.id,
            error: error.message,
          });
        }
      }

      this.logger.log(
        `🎯 Consistency fix completed: ${fixed} fixed, ${errors.length} errors`,
      );

      return { fixed, errors };
    } catch (error) {
      this.logger.error(
        'Error fixing subscription visibility inconsistencies:',
        error,
      );
      throw error;
    }
  }
}
