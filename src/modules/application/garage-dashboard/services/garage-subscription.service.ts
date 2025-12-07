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
            // ✅ FIXED: Show all active plans regardless of legacy status
            // New users will get the current price_pence value
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
            trial_period_days: true,
          },
        }),
        this.prisma.subscriptionPlan.count({
          where: {
            is_active: true,
            // ✅ FIXED: Count all active plans
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
          success: false,
          message: 'No subscription found',
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
        success: formattedSubscription ? true : false,
        message: formattedSubscription
          ? 'Subscription found'
          : 'No subscription found',
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

    // ✅ FIXED: Check if this is actually a trial subscription
    // A subscription is in trial if:
    // 1. It has a trial_period_days > 0 in the plan
    // 2. Current period end is within trial period from start
    // 3. OR Stripe status is 'trialing'

    const plan = subscription.plan;
    const hasTrialPeriod =
      plan?.trial_period_days && plan.trial_period_days > 0;

    if (!hasTrialPeriod) {
      // ✅ No trial period configured - return null
      return null;
    }

    const trialEndDate = new Date(periodEnd);
    const daysRemaining = Math.ceil(
      (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    // ✅ FIXED: Proper trial detection
    const isInTrial =
      subscription.status === 'ACTIVE' &&
      Boolean(subscription.stripe_subscription_id) &&
      daysRemaining > 0;

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
      const success_url = `${appConfig().app.client_app_url}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel_url = `${appConfig().app.client_app_url}/subscription/cancel`;

      // Use plan's trial period (business controls trial length)
      const trialDays =
        plan.trial_period_days !== undefined ? plan.trial_period_days : 14; // Fallback to 14 days if not set

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
            trial_period_days: trialDays,
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
              trial_period_days: trialDays,
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

      // Get garage's current subscription (including PAST_DUE for payment failures)
      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: {
            in: ['ACTIVE', 'PAST_DUE'], // Include PAST_DUE for payment failure scenarios
          },
        },
        include: {
          garage: {
            select: { billing_id: true },
          },
        },
        orderBy: {
          created_at: 'desc',
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

      // 🆕 ENHANCED: Add context for payment failure scenarios
      const responseData: any = {
        url: session.url,
      };

      // Add payment failure context if subscription is PAST_DUE
      if (subscription.status === 'PAST_DUE') {
        const gracePeriodDays = 3;
        const now = new Date();
        const gracePeriodEnd = new Date(
          subscription.updated_at.getTime() +
            gracePeriodDays * 24 * 60 * 60 * 1000,
        );
        const daysRemaining = Math.ceil(
          (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        responseData.payment_failure_context = {
          is_payment_failed: true,
          grace_period_active: daysRemaining > 0,
          grace_period_end: gracePeriodEnd.toISOString(),
          grace_period_days_remaining: Math.max(0, daysRemaining),
          urgency_level:
            daysRemaining <= 1 ? 'high' : daysRemaining <= 2 ? 'medium' : 'low',
        };
      }

      return {
        success: true,
        data: responseData,
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

      if (dto.cancel_type === 'immediate') {
        // ✅ FIXED: Cancel immediately in Stripe only - let webhook handle the rest
        await StripePayment.cancelSubscription(
          subscription.stripe_subscription_id,
        );

        this.logger.log(
          `Subscription cancellation initiated in Stripe for garage ${garageId}. Webhook will process the changes.`,
        );

        return {
          success: true,
          message:
            'Subscription cancelled immediately. Webhook will process the changes.',
          effective_date: new Date(),
          cancelled_immediately: true,
        };
      } else {
        // ✅ FIXED: Proper end-of-period cancellation
        await StripePayment.cancelSubscriptionAtPeriodEnd(
          subscription.stripe_subscription_id,
        );

        // Update local database to show pending cancellation (not cancelled yet)
        await this.prisma.garageSubscription.update({
          where: { id: subscription.id },
          data: {
            cancel_at_period_end: true,
            // Keep status as ACTIVE until period ends
            updated_at: new Date(),
          },
        });

        this.logger.log(
          `Subscription scheduled for end-of-period cancellation for garage ${garageId}`,
        );

        return {
          success: true,
          message:
            'Subscription will be cancelled at the end of current billing period',
          effective_date: subscription.current_period_end || new Date(),
          cancelled_immediately: false,
        };
      }
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

    // Trial period information
    if (plan.trial_period_days > 0) {
      features.push(`${plan.trial_period_days}-day free trial`);
    } else {
      features.push('Immediate access');
    }

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

  /**
   * Validate Stripe checkout session and return subscription details
   * This method handles the success redirect from Stripe checkout
   */
  async validateCheckoutSession(sessionId: string) {
    try {
      this.logger.log(`Validating checkout session: ${sessionId}`);

      // Retrieve session from Stripe
      const session = await StripePayment.retrieveCheckoutSession(sessionId);

      if (!session) {
        throw new NotFoundException('Checkout session not found');
      }

      // Validate session is completed
      if (session.payment_status !== 'paid') {
        throw new BadRequestException(
          `Payment not completed. Status: ${session.payment_status}`,
        );
      }

      // Get subscription ID from session
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

      if (!subscriptionId) {
        throw new BadRequestException(
          'No subscription found in checkout session',
        );
      }

      // Retrieve subscription from Stripe
      const stripeSubscription =
        await StripePayment.retrieveSubscription(subscriptionId);
      if (!stripeSubscription) {
        throw new NotFoundException('Stripe subscription not found');
      }

      // Find garage subscription in database
      const garageSubscription =
        (await this.prisma.garageSubscription.findFirst({
          where: {
            stripe_subscription_id: subscriptionId,
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
            garage: {
              select: {
                id: true,
                garage_name: true,
                email: true,
              },
            },
          },
        })) as any; // Type assertion to handle Prisma include types

      if (!garageSubscription) {
        throw new NotFoundException(
          'Garage subscription not found in database',
        );
      }

      // ✅ FIXED: Determine subscription type and trial information
      const trialInfo = this.getTrialInformation(garageSubscription);
      const isTrial = trialInfo?.is_trial || false;
      const isActive =
        stripeSubscription.status === 'active' ||
        stripeSubscription.status === 'trialing';

      // ✅ ENHANCED: Generate status explanation and details for frontend clarity
      const statusInfo =
        this.generateSubscriptionStatusInfo(garageSubscription);

      // Format response data
      const responseData = {
        session_id: sessionId,
        subscription: {
          id: garageSubscription.id,
          stripe_subscription_id: subscriptionId,
          status: garageSubscription.status,
          status_explanation: statusInfo.explanation,
          status_details: statusInfo.details,
          plan: {
            id: garageSubscription.plan.id,
            name: garageSubscription.plan.name,
            price_pence: garageSubscription.price_pence,
            currency: garageSubscription.currency,
            price_formatted: this.formatPrice(
              garageSubscription.price_pence,
              garageSubscription.currency,
            ),
          },
          current_period_start: garageSubscription.current_period_start,
          current_period_end: garageSubscription.current_period_end,
          next_billing_date: garageSubscription.next_billing_date,
          trial_information: trialInfo, // ✅ FIXED: Use proper trial information
          garage: {
            id: garageSubscription.garage.id,
            name: garageSubscription.garage.garage_name,
            email: garageSubscription.garage.email,
          },
        },
      };

      this.logger.log(
        `Checkout session validated successfully for garage ${garageSubscription.garage_id}: ${garageSubscription.plan.name} (Trial: ${isTrial})`,
      );

      return {
        success: true,
        message: isTrial
          ? 'Trial subscription activated successfully'
          : 'Subscription activated successfully',
        data: responseData,
      };
    } catch (error) {
      this.logger.error(
        `Failed to validate checkout session ${sessionId}:`,
        error,
      );

      // Handle specific error types
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle Stripe API errors
      if (error.message?.includes('No such session')) {
        throw new NotFoundException('Checkout session not found');
      }

      if (error.message?.includes('No such subscription')) {
        throw new NotFoundException('Subscription not found');
      }

      // Generic error handling
      throw new BadRequestException(
        `Failed to validate checkout session: ${error.message}`,
      );
    }
  }

  /**
   * Generate comprehensive status information for frontend clarity
   * This method provides both technical status and human-readable explanations
   */
  private generateSubscriptionStatusInfo(subscription: any): {
    explanation: string;
    details: {
      is_active: boolean;
      has_access: boolean;
      access_until?: string;
      will_renew: boolean;
      cancellation_scheduled: boolean;
      cancellation_date?: string;
      days_remaining?: number;
      urgency_level?: 'low' | 'medium' | 'high';
    };
  } {
    const now = new Date();
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : null;
    const daysRemaining = periodEnd
      ? Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    let explanation: string;
    let isActive = false;
    let hasAccess = false;
    let willRenew = false;
    let cancellationScheduled = false;

    switch (subscription.status) {
      case 'ACTIVE':
        explanation =
          'Your subscription is active and will renew automatically on the next billing date';
        isActive = true;
        hasAccess = true;
        willRenew = !subscription.cancel_at_period_end;
        cancellationScheduled = Boolean(subscription.cancel_at_period_end);
        break;

      case 'CANCELLED':
        if (periodEnd && periodEnd > now) {
          explanation =
            'Your subscription is active until the end of the current period, then will be cancelled as previously scheduled';
          isActive = true;
          hasAccess = true;
          willRenew = false;
          cancellationScheduled = true;
        } else {
          explanation =
            'Your subscription has been cancelled and is no longer active';
          isActive = false;
          hasAccess = false;
          willRenew = false;
          cancellationScheduled = true;
        }
        break;

      case 'PAST_DUE':
        explanation =
          'Your payment failed. You have 3 days to update your payment method before services are suspended';
        isActive = false;
        hasAccess = true; // Grace period active
        willRenew = false;
        cancellationScheduled = false;
        break;

      case 'SUSPENDED':
        explanation =
          'Your subscription has been suspended due to payment issues. Please update your payment method to reactivate';
        isActive = false;
        hasAccess = false;
        willRenew = false;
        cancellationScheduled = false;
        break;

      case 'INACTIVE':
        explanation =
          'Your subscription is inactive. Please subscribe to a plan to access services';
        isActive = false;
        hasAccess = false;
        willRenew = false;
        cancellationScheduled = false;
        break;

      default:
        explanation =
          'Subscription status is being processed. Please contact support if this persists';
        isActive = false;
        hasAccess = false;
        willRenew = false;
        cancellationScheduled = false;
    }

    // Determine urgency level for PAST_DUE subscriptions
    let urgencyLevel: 'low' | 'medium' | 'high' | undefined;
    if (subscription.status === 'PAST_DUE') {
      if (daysRemaining <= 1) {
        urgencyLevel = 'high';
      } else if (daysRemaining <= 2) {
        urgencyLevel = 'medium';
      } else {
        urgencyLevel = 'low';
      }
    }

    return {
      explanation,
      details: {
        is_active: isActive,
        has_access: hasAccess,
        access_until: periodEnd ? periodEnd.toISOString() : undefined,
        will_renew: willRenew,
        cancellation_scheduled: cancellationScheduled,
        cancellation_date:
          subscription.cancel_at ||
          subscription.current_period_end ||
          undefined,
        days_remaining: daysRemaining > 0 ? daysRemaining : undefined,
        urgency_level: urgencyLevel,
      },
    };
  }
}
