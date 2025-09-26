import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StripePayment } from '../../../../common/lib/Payment/stripe/StripePayment';
import { SubscriptionCheckoutDto } from '../dto/subscription-checkout.dto';
import { CancelSubscriptionDto } from '../dto/billing-portal.dto';
import { SubscriptionVisibilityService } from '../../../../common/lib/subscription/subscription-visibility.service';

@Injectable()
export class GarageSubscriptionService {
  private readonly logger = new Logger(GarageSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionVisibilityService: SubscriptionVisibilityService,
  ) {}

  /**
   * Helper method to update user subscription visibility status
   * Delegates to the shared SubscriptionVisibilityService
   *
   * @param garageId - The ID of the garage user
   */
  private async updateUserSubscriptionStatus(garageId: string): Promise<void> {
    await this.subscriptionVisibilityService.updateUserSubscriptionStatus(
      garageId,
      'garage-dashboard',
    );
  }

  /**
   * Get all active subscription plans available for garages
   */
  async getAvailablePlans(page: number = 1, limit: number = 20) {
    try {
      this.logger.log(
        `Fetching available plans - page: ${page}, limit: ${limit}`,
      );

      const skip = (page - 1) * limit;

      const [plans, total] = await Promise.all([
        this.prisma.subscriptionPlan.findMany({
          where: {
            is_active: true,
            is_legacy_price: false, // Only show current pricing
          },
          skip,
          take: limit,
          orderBy: { price_pence: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price_pence: true,
            currency: true,
            max_bookings_per_month: true,
            max_vehicles: true,
            priority_support: true,
            advanced_analytics: true,
            custom_branding: true,
            stripe_price_id: true,
          },
        }),
        this.prisma.subscriptionPlan.count({
          where: {
            is_active: true,
            is_legacy_price: false,
          },
        }),
      ]);

      const formattedPlans = plans.map((plan) => ({
        ...plan,
        price_formatted: this.formatPrice(plan.price_pence, plan.currency),
        features: this.generateFeatureList(plan),
      }));

      return {
        success: true,
        data: {
          plans: formattedPlans,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      this.logger.error('Failed to fetch available plans:', error);
      throw error;
    }
  }

  /**
   * Get garage's current subscription status
   */
  async getCurrentSubscription(garageId: string) {
    try {
      this.logger.log(`Fetching current subscription for garage: ${garageId}`);

      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: {
            in: ['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'],
          },
        },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              price_pence: true,
              currency: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      if (!subscription) {
        return {
          success: true,
          data: null,
        };
      }

      // Get user subscription visibility status
      const visibilityStatus =
        await this.subscriptionVisibilityService.getSubscriptionVisibilityStatus(
          garageId,
        );

      // Determine subscription type and trial information
      const isTrial =
        subscription.status === 'ACTIVE' && subscription.stripe_subscription_id;
      const isScheduledForCancellation =
        subscription.status === 'CANCELLED' && subscription.current_period_end;
      const isActiveTrial = isTrial && !isScheduledForCancellation;
      const isTrialWithCancellation = isTrial && isScheduledForCancellation;

      const formattedSubscription = {
        id: subscription.id,
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          currency: subscription.plan.currency,
          price_pence: subscription.price_pence,
          price_formatted: this.formatPrice(
            subscription.price_pence,
            subscription.currency,
          ),
        },
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        next_billing_date: subscription.next_billing_date,
        can_cancel: subscription.status === 'ACTIVE',
        created_at: subscription.created_at,

        // Enhanced trial information
        subscription_type: this.determineSubscriptionType(subscription),
        trial_information: this.getTrialInformation(subscription),
        cancellation_information: this.getCancellationInformation(subscription),
        visibility: {
          is_visible_to_drivers: visibilityStatus.hasSubscription,
          visible_until: visibilityStatus.expiresAt,
        },
      };

      return {
        success: true,
        data: formattedSubscription,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch current subscription for garage ${garageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Format price in pence to currency string
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

  /**
   * Determine subscription type based on status and Stripe data
   */
  private determineSubscriptionType(subscription: any): string {
    if (
      subscription.status === 'CANCELLED' &&
      subscription.current_period_end
    ) {
      return 'trial_with_cancellation';
    }
    if (
      subscription.status === 'ACTIVE' &&
      subscription.stripe_subscription_id
    ) {
      return 'active_trial';
    }
    if (subscription.status === 'ACTIVE') {
      return 'active_subscription';
    }
    if (subscription.status === 'PAST_DUE') {
      return 'past_due';
    }
    if (subscription.status === 'SUSPENDED') {
      return 'suspended';
    }
    return 'inactive';
  }

  /**
   * Get trial information for the subscription
   */
  private getTrialInformation(subscription: any): any {
    const now = new Date();
    const periodEnd = subscription.current_period_end;

    if (!periodEnd) {
      return null;
    }

    const isInTrial =
      subscription.status === 'ACTIVE' &&
      Boolean(subscription.stripe_subscription_id);
    const trialEndDate = new Date(periodEnd);
    const daysRemaining = Math.ceil(
      (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      is_trial: isInTrial,
      trial_end: periodEnd,
      days_remaining: Math.max(0, daysRemaining),
      is_trial_active: isInTrial && daysRemaining > 0,
      trial_status: isInTrial
        ? daysRemaining > 0
          ? 'active'
          : 'expired'
        : null,
    };
  }

  /**
   * Get cancellation information for the subscription
   */
  private getCancellationInformation(subscription: any): any {
    const willCancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    const hasExplicitCancelAt = Boolean(subscription.cancel_at);

    if (!willCancelAtPeriodEnd && !hasExplicitCancelAt) {
      return null;
    }

    const now = new Date();
    const effectiveCancellationDate =
      subscription.cancel_at || subscription.current_period_end || null;

    if (!effectiveCancellationDate) {
      return null;
    }

    const cancellationDate = new Date(effectiveCancellationDate);
    const daysUntilCancellation = Math.ceil(
      (cancellationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      is_scheduled_for_cancellation: true,
      cancellation_date: effectiveCancellationDate,
      days_until_cancellation: Math.max(0, daysUntilCancellation),
      will_cancel_at_period_end: willCancelAtPeriodEnd,
      cancellation_reason: subscription.cancellation_reason || null,
    };
  }

  /**
   * Create Stripe checkout session for subscription
   */
  async createCheckoutSession(garageId: string, dto: SubscriptionCheckoutDto) {
    try {
      this.logger.log(
        `Creating checkout session for garage ${garageId}, plan: ${dto.plan_id}`,
      );

      // Check if garage already has an active subscription
      const existingSubscription =
        await this.prisma.garageSubscription.findFirst({
          where: {
            garage_id: garageId,
            status: 'ACTIVE',
          },
        });

      if (existingSubscription) {
        throw new ConflictException(
          'You already have an active subscription. Please cancel your current subscription before starting a new one.',
        );
      }

      // Get the plan and validate it exists and is available
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: dto.plan_id },
      });

      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      if (!plan.is_active) {
        throw new BadRequestException(
          'This plan is not available for subscription',
        );
      }

      if (!plan.stripe_price_id) {
        throw new BadRequestException(
          'No valid price available for this plan. Please contact support.',
        );
      }

      // Get or create Stripe customer
      const garage = await this.prisma.user.findUnique({
        where: { id: garageId },
        select: {
          id: true,
          name: true,
          email: true,
          billing_id: true,
        },
      });

      if (!garage) {
        throw new NotFoundException('Garage not found');
      }

      let stripeCustomerId = garage.billing_id;

      if (!stripeCustomerId) {
        // Create Stripe customer
        const customer = await StripePayment.createCustomer({
          user_id: garage.id,
          name: garage.name || garage.email,
          email: garage.email || '',
        });

        stripeCustomerId = customer.id;

        // Update garage with billing ID
        await this.prisma.user.update({
          where: { id: garageId },
          data: { billing_id: stripeCustomerId },
        });
      } else {
        // Validate existing customer ID and handle invalid ones
        try {
          await StripePayment.validateCustomer(stripeCustomerId);
        } catch (error) {
          // If customer doesn't exist in Stripe, clear the invalid ID and create a new one
          if (error.message?.includes('No such customer')) {
            this.logger.warn(
              `Invalid customer ID found for garage ${garageId}: ${stripeCustomerId}. Creating new customer.`,
            );

            // Clear the invalid customer ID
            await this.prisma.user.update({
              where: { id: garageId },
              data: { billing_id: null },
            });

            // Create new Stripe customer
            const customer = await StripePayment.createCustomer({
              user_id: garage.id,
              name: garage.name || garage.email,
              email: garage.email || '',
            });

            stripeCustomerId = customer.id;

            // Update garage with new billing ID
            await this.prisma.user.update({
              where: { id: garageId },
              data: { billing_id: stripeCustomerId },
            });

            this.logger.log(
              `Successfully created new customer for garage ${garageId}: ${stripeCustomerId}`,
            );
          } else {
            // Re-throw other Stripe errors
            throw error;
          }
        }
      }

      // Create initial garage subscription record with INACTIVE status
      const garageSubscription = await this.prisma.garageSubscription.create({
        data: {
          garage_id: garageId,
          plan_id: plan.id,
          status: 'INACTIVE',
          price_pence: plan.price_pence,
          currency: plan.currency,
          stripe_customer_id: stripeCustomerId,
          // Will be updated when webhook processes the subscription
          current_period_start: null,
          current_period_end: null,
          next_billing_date: null,
        },
      });

      // Create checkout session with metadata using StripePayment
      const appConfig = require('../../../../config/app.config').default;
      const success_url = `${appConfig().app.url}/garage-dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel_url = `${appConfig().app.url}/garage-dashboard/subscription/cancel`;

      let session;
      try {
        session =
          await StripePayment.createCheckoutSessionSubscriptionWithMetadata({
            customer: stripeCustomerId,
            price: plan.stripe_price_id,
            metadata: {
              garage_id: garageId,
              plan_id: plan.id,
              garage_subscription_id: garageSubscription.id,
              source: 'garage_dashboard',
            },
            success_url: success_url,
            cancel_url: cancel_url,
          });
      } catch (error) {
        // If customer doesn't exist in Stripe, clear the invalid ID and create a new one
        if (error.message?.includes('No such customer')) {
          this.logger.warn(
            `Invalid customer ID found during checkout for garage ${garageId}: ${stripeCustomerId}. Creating new customer and retrying.`,
          );

          // Clear the invalid customer ID
          await this.prisma.user.update({
            where: { id: garageId },
            data: { billing_id: null },
          });

          // Create new Stripe customer
          const customer = await StripePayment.createCustomer({
            user_id: garage.id,
            name: garage.name || garage.email,
            email: garage.email || '',
          });

          stripeCustomerId = customer.id;

          // Update garage with new billing ID
          await this.prisma.user.update({
            where: { id: garageId },
            data: { billing_id: stripeCustomerId },
          });

          // Update garage subscription record with new customer ID
          await this.prisma.garageSubscription.update({
            where: { id: garageSubscription.id },
            data: { stripe_customer_id: stripeCustomerId },
          });

          this.logger.log(
            `Successfully created new customer for garage ${garageId}: ${stripeCustomerId}. Retrying checkout.`,
          );

          // Retry checkout with new customer ID
          session =
            await StripePayment.createCheckoutSessionSubscriptionWithMetadata({
              customer: stripeCustomerId,
              price: plan.stripe_price_id,
              metadata: {
                garage_id: garageId,
                plan_id: plan.id,
                garage_subscription_id: garageSubscription.id,
                source: 'garage_dashboard',
              },
              success_url: success_url,
              cancel_url: cancel_url,
            });
        } else {
          // Re-throw other Stripe errors
          throw error;
        }
      }

      return {
        success: true,
        data: {
          checkout_url: session.url,
          session_id: session.id,
          subscription_id: garageSubscription.id,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to create checkout session for garage ${garageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create billing portal session for subscription management
   */
  async createBillingPortalSession(garageId: string) {
    try {
      this.logger.log(
        `Creating billing portal session for garage: ${garageId}`,
      );

      // Get garage's current subscription
      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: 'ACTIVE',
        },
        include: {
          garage: {
            select: { billing_id: true },
          },
        },
      });

      if (!subscription) {
        throw new NotFoundException(
          'No active subscription found. Please subscribe to a plan first.',
        );
      }

      if (!subscription.garage.billing_id) {
        throw new BadRequestException(
          'No billing information found. Please contact support.',
        );
      }

      // Create billing portal session
      const session = await StripePayment.createBillingSession(
        subscription.garage.billing_id,
      );

      return {
        success: true,
        data: {
          url: session.url,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to create billing portal session for garage ${garageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Cancel garage subscription
   */
  async cancelSubscription(garageId: string, dto: CancelSubscriptionDto) {
    try {
      this.logger.log(
        `Cancelling subscription for garage ${garageId}, type: ${dto.cancel_type}`,
      );

      // Get garage's active subscription
      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: 'ACTIVE',
        },
      });

      if (!subscription) {
        throw new NotFoundException('No active subscription found to cancel.');
      }

      if (!subscription.stripe_subscription_id) {
        throw new BadRequestException(
          'No Stripe subscription linked. Please contact support.',
        );
      }

      let effectiveDate: Date;
      let cancelledImmediately = false;

      if (dto.cancel_type === 'immediate') {
        // Cancel immediately
        await StripePayment.cancelSubscription(
          subscription.stripe_subscription_id,
        );

        // Update local subscription status
        await this.prisma.garageSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED',
            updated_at: new Date(),
          },
        });

        // Update user subscription visibility status
        await this.updateUserSubscriptionStatus(garageId);

        effectiveDate = new Date();
        cancelledImmediately = true;
      } else {
        // Cancel at period end
        // Note: For immediate cancellation at period end, we still use cancelSubscription
        // Stripe will handle the timing automatically
        await StripePayment.cancelSubscription(
          subscription.stripe_subscription_id,
        );

        // Update local subscription status to indicate pending cancellation
        await this.prisma.garageSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED', // Will be effective at period end
            updated_at: new Date(),
          },
        });

        // Update user subscription visibility status
        await this.updateUserSubscriptionStatus(garageId);

        effectiveDate = subscription.current_period_end || new Date();
        cancelledImmediately = false;
      }

      return {
        success: true,
        message:
          dto.cancel_type === 'immediate'
            ? 'Subscription cancelled immediately'
            : 'Subscription will be cancelled at the end of current billing period',
        effective_date: effectiveDate,
        cancelled_immediately: cancelledImmediately,
      };
    } catch (error) {
      this.logger.error(
        `Failed to cancel subscription for garage ${garageId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate feature list based on plan capabilities
   */
  private generateFeatureList(plan: any): string[] {
    const features: string[] = [];

    // Base features
    features.push(`${plan.max_bookings_per_month} bookings/month`);
    features.push(`${plan.max_vehicles} vehicles`);

    // Premium features
    if (plan.priority_support) {
      features.push('Priority support');
    }
    if (plan.advanced_analytics) {
      features.push('Advanced analytics');
    }
    if (plan.custom_branding) {
      features.push('Custom branding');
    }

    return features;
  }
}
