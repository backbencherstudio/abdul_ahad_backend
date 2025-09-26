import { Injectable } from '@nestjs/common';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StripeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Helper method to update user subscription visibility status
   * This method ensures the has_subscription field is properly maintained
   * based on the garage's current subscription status
   *
   * @param garageId - The ID of the garage user
   * @throws Error if database operations fail
   */
  private async updateUserSubscriptionStatus(garageId: string): Promise<void> {
    try {
      // Validate garage ID
      if (!garageId || typeof garageId !== 'string') {
        throw new Error(`Invalid garage ID provided: ${garageId}`);
      }

      console.log(`🔄 Updating subscription status for garage: ${garageId}`);

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

      console.log(
        `✅ Updated subscription status for garage ${garageId} (${garageInfo.garage_name || garageInfo.email}): ` +
          `has_subscription=${hasSubscription}, expires_at=${subscriptionExpiresAt}, ` +
          `plan=${planName}`,
      );

      // Log driver visibility impact
      if (hasSubscription) {
        console.log(`👁️ Garage ${garageId} is now VISIBLE to drivers`);
      } else {
        console.log(`🚫 Garage ${garageId} is now HIDDEN from drivers`);
      }
    } catch (error) {
      console.error(
        `❌ Critical error updating subscription status for garage ${garageId}:`,
        {
          error: error.message,
          stack: error.stack,
          garageId,
        },
      );

      // Don't re-throw for webhook handlers to prevent webhook failures
      // Log the error and continue processing
      console.error(
        `⚠️ Continuing webhook processing despite subscription status update failure`,
      );
    }
  }

  // ✅ EXISTING: Your existing webhook handler (KEEP THIS)
  async handleWebhook(rawBody: string, sig: string | string[]) {
    return StripePayment.handleWebhook(rawBody, sig);
  }

  // ✅ NEW: Subscription event handlers (ADDED TO YOUR EXISTING CODE)

  // Handle subscription created
  async handleSubscriptionCreated(subscription: any) {
    try {
      // Check if this is a garage subscription (has garage metadata)
      if (subscription.metadata?.source === 'garage_dashboard') {
        await this.handleGarageSubscriptionCreated(subscription);
        return;
      }

      // Handle admin subscriptions (existing logic)
      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: { stripe_subscription_id: subscription.id },
          include: { garage: true, plan: true },
        },
      );

      if (garageSubscription) {
        await this.prisma.garageSubscription.update({
          where: { id: garageSubscription.id },
          data: {
            status: 'ACTIVE',
            current_period_start: new Date(
              subscription.current_period_start * 1000,
            ),
            current_period_end: new Date(
              subscription.current_period_end * 1000,
            ),
            next_billing_date: new Date(subscription.current_period_end * 1000),
          },
        });

        console.log(
          `Subscription activated for garage: ${garageSubscription.garage.email}`,
        );
      }
    } catch (error) {
      console.error('Error handling subscription created:', error);
    }
  }

  // Handle garage subscription created (new method)
  async handleGarageSubscriptionCreated(subscription: any) {
    try {
      const metadata = subscription.metadata;

      if (!metadata?.garage_subscription_id) {
        console.error(
          'No garage_subscription_id in metadata for subscription:',
          subscription.id,
        );
        return;
      }

      // Find the pending garage subscription record
      const garageSubscription =
        await this.prisma.garageSubscription.findUnique({
          where: { id: metadata.garage_subscription_id },
          include: { garage: true, plan: true },
        });

      if (!garageSubscription) {
        console.error(
          'No garage subscription found with ID:',
          metadata.garage_subscription_id,
        );
        return;
      }

      // Update the subscription record with Stripe data
      await this.prisma.garageSubscription.update({
        where: { id: garageSubscription.id },
        data: {
          status: 'ACTIVE',
          stripe_subscription_id: subscription.id,
          current_period_start: new Date(
            subscription.current_period_start * 1000,
          ),
          current_period_end: new Date(subscription.current_period_end * 1000),
          next_billing_date: new Date(subscription.current_period_end * 1000),
          updated_at: new Date(),
        },
      });

      // Update user subscription visibility status
      await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

      console.log(
        `✅ Garage subscription activated: ${garageSubscription.garage.email} (Plan: ${garageSubscription.plan.name})`,
      );
    } catch (error) {
      console.error('Error handling garage subscription created:', error);
    }
  }

  // Handle subscription updated
  async handleSubscriptionUpdated(subscription: any) {
    try {
      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: { stripe_subscription_id: subscription.id },
          include: { garage: true, plan: true },
        },
      );

      if (garageSubscription) {
        // Update subscription status based on Stripe status
        const statusMapping = {
          active: 'ACTIVE',
          trialing: 'ACTIVE', // Treat trialing as active for visibility
          past_due: 'PAST_DUE',
          canceled: 'CANCELLED',
          unpaid: 'PAST_DUE',
          incomplete: 'INACTIVE',
          incomplete_expired: 'CANCELLED',
          paused: 'SUSPENDED',
        };

        const newStatus = statusMapping[subscription.status] || 'INACTIVE';

        await this.prisma.garageSubscription.update({
          where: { id: garageSubscription.id },
          data: {
            status: newStatus,
            current_period_start: new Date(
              subscription.current_period_start * 1000,
            ),
            current_period_end: new Date(
              subscription.current_period_end * 1000,
            ),
            next_billing_date: new Date(subscription.current_period_end * 1000),
            cancel_at: subscription.cancel_at
              ? new Date(subscription.cancel_at * 1000)
              : null,
            cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
            cancellation_reason:
              subscription.cancellation_details?.feedback || null,
            updated_at: new Date(),
          },
        });

        // Update user subscription visibility status
        await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

        console.log(
          `✅ Subscription updated for garage: ${garageSubscription.garage.email} (Status: ${newStatus})`,
        );
      }
    } catch (error) {
      console.error('Error handling subscription updated:', error);
    }
  }

  // Handle subscription cancelled
  async handleSubscriptionCancelled(subscription: any) {
    try {
      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: { stripe_subscription_id: subscription.id },
          include: { garage: true, plan: true },
        },
      );

      if (garageSubscription) {
        await this.prisma.garageSubscription.update({
          where: { id: garageSubscription.id },
          data: {
            status: 'CANCELLED',
            updated_at: new Date(),
          },
        });

        // Update user subscription visibility status
        // This will set has_subscription to false since subscription is cancelled
        await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

        console.log(
          `✅ Subscription cancelled for garage: ${garageSubscription.garage.email}`,
        );
      }
    } catch (error) {
      console.error('Error handling subscription cancelled:', error);
    }
  }

  // Handle payment succeeded
  async handlePaymentSucceeded(invoice: any) {
    try {
      if (invoice.subscription) {
        const garageSubscription =
          await this.prisma.garageSubscription.findFirst({
            where: { stripe_subscription_id: invoice.subscription },
            include: { garage: true, plan: true },
          });

        if (garageSubscription) {
          // Update subscription status to ACTIVE if payment succeeded
          await this.prisma.garageSubscription.update({
            where: { id: garageSubscription.id },
            data: {
              status: 'ACTIVE',
              updated_at: new Date(),
            },
          });

          // Create payment transaction record
          await this.prisma.paymentTransaction.create({
            data: {
              user_id: garageSubscription.garage_id,
              garage_id: garageSubscription.garage_id,
              amount: invoice.amount_paid / 100, // Convert from cents
              currency: invoice.currency,
              type: 'SUBSCRIPTION',
              status: 'PAID',
              provider: 'stripe',
              reference_number: invoice.id,
              raw_status: 'succeeded',
            },
          });

          // Update user subscription visibility status
          // This will ensure has_subscription is true after successful payment
          await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

          console.log(
            `✅ Payment succeeded for garage: ${garageSubscription.garage.email} (Amount: ${invoice.amount_paid / 100} ${invoice.currency})`,
          );
        }
      }
    } catch (error) {
      console.error('Error handling payment succeeded:', error);
    }
  }

  // Handle payment failed
  async handlePaymentFailed(invoice: any) {
    try {
      if (invoice.subscription) {
        const garageSubscription =
          await this.prisma.garageSubscription.findFirst({
            where: { stripe_subscription_id: invoice.subscription },
            include: { garage: true, plan: true },
          });

        if (garageSubscription) {
          // Update subscription status to PAST_DUE
          await this.prisma.garageSubscription.update({
            where: { id: garageSubscription.id },
            data: {
              status: 'PAST_DUE',
              updated_at: new Date(),
            },
          });

          // Update user subscription visibility status
          // This will set has_subscription to false since payment failed
          await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

          console.log(
            `❌ Payment failed for garage: ${garageSubscription.garage.email} (Amount: ${invoice.amount_due / 100} ${invoice.currency})`,
          );
        }
      }
    } catch (error) {
      console.error('Error handling payment failed:', error);
    }
  }
}
