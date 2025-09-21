import { Injectable } from '@nestjs/common';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StripeService {
  constructor(private prisma: PrismaService) {}

  // ✅ EXISTING: Your existing webhook handler (KEEP THIS)
  async handleWebhook(rawBody: string, sig: string | string[]) {
    return StripePayment.handleWebhook(rawBody, sig);
  }

  // ✅ NEW: Subscription event handlers (ADDED TO YOUR EXISTING CODE)

  // Handle subscription created
  async handleSubscriptionCreated(subscription: any) {
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
        await this.prisma.garageSubscription.update({
          where: { id: garageSubscription.id },
          data: {
            status: subscription.status.toUpperCase(),
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
          `Subscription updated for garage: ${garageSubscription.garage.email}`,
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
          },
        });

        console.log(
          `Subscription cancelled for garage: ${garageSubscription.garage.email}`,
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

          console.log(
            `Payment succeeded for garage: ${garageSubscription.garage.email}`,
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
          await this.prisma.garageSubscription.update({
            where: { id: garageSubscription.id },
            data: {
              status: 'PAST_DUE',
            },
          });

          console.log(
            `Payment failed for garage: ${garageSubscription.garage.email}`,
          );
        }
      }
    } catch (error) {
      console.error('Error handling payment failed:', error);
    }
  }
}
