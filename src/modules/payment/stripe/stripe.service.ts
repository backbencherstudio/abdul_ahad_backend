import { Injectable, Logger } from '@nestjs/common';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { NotificationService } from 'src/modules/application/notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Helper method to update user subscription visibility status
   * This method ensures the has_subscription field is properly maintained
   * based on the garage's current subscription status
   *
   * @param garageId - The ID of the garage user
   * @throws Error if database operations fail
   */
  private async updateUserSubscriptionStatus(
    garageId: string,
    shouldHideFromDrivers?: boolean,
  ): Promise<void> {
    try {
      // Validate garage ID
      if (!garageId || typeof garageId !== 'string') {
        throw new Error(`Invalid garage ID provided: ${garageId}`);
      }

      //console.log(`🔄 Updating subscription status for garage: ${garageId}`);

      // Find the most recent subscription for this garage (including PAST_DUE for grace period logic)
      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: {
            in: ['ACTIVE', 'PAST_DUE'], // Include PAST_DUE for grace period visibility
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
      });

      // 🆕 GRACE PERIOD LOGIC: Determine visibility based on grace period
      let hasSubscription = false;
      let subscriptionExpiresAt = null;

      if (subscription) {
        if (subscription.status === 'ACTIVE') {
          // Active subscription - always visible
          hasSubscription = true;
          subscriptionExpiresAt = subscription.current_period_end;
        } else if (subscription.status === 'PAST_DUE') {
          // Past due subscription - visible during grace period
          if (shouldHideFromDrivers === false) {
            // Grace period active - keep visible
            hasSubscription = true;
            subscriptionExpiresAt = subscription.current_period_end;
          } else {
            // Grace period expired or explicitly hidden
            hasSubscription = false;
            subscriptionExpiresAt = null;
          }
        }
      }
      const garageInfo = subscription?.garage || {
        email: 'Unknown',
        garage_name: 'Unknown',
      };
      const planName = subscription?.plan?.name || 'None';

      // Update user record with subscription status
      await this.prisma.user.update({
        where: { id: garageId },
        data: {
          has_subscription: hasSubscription,
          subscription_expires_at: subscriptionExpiresAt,
        },
      });

      // 🆕 ENHANCED STATUS TRANSITION LOGGING
      const statusTransition = {
        garage_id: garageId,
        garage_email: garageInfo.email,
        garage_name: garageInfo.garage_name,
        previous_status: subscription?.status || 'None',
        new_status: hasSubscription ? 'VISIBLE' : 'HIDDEN',
        subscription_status: subscription?.status || 'None',
        plan_name: planName,
        subscription_expires_at: subscriptionExpiresAt,
        transition_reason: this.getTransitionReason(
          subscription,
          hasSubscription,
        ),
        timestamp: new Date().toISOString(),
      };

      //console.log(
      //  `✅ Updated subscription status for garage ${garageId} (${garageInfo.garage_name || garageInfo.email}): ` +
      //    `has_subscription=${hasSubscription}, expires_at=${subscriptionExpiresAt}, ` +
      //    `plan=${planName}, status=${subscription?.status || 'None'}`,
      //);

      // 🆕 DETAILED STATUS TRANSITION LOG
      //console.log(
      //  `📊 STATUS TRANSITION:`,
      //  JSON.stringify(statusTransition, null, 2),
      //);

      // Log driver visibility impact
      if (hasSubscription) {
        //console.log(`👁️ Garage ${garageId} is now VISIBLE to drivers`);
      } else {
        //console.log(`🚫 Garage ${garageId} is now HIDDEN from drivers`);
      }
    } catch (error) {
      //console.error(
      //  `❌ Critical error updating subscription status for garage ${garageId}:`,
      //  {
      //    error: error.message,
      //    stack: error.stack,
      //    garageId,
      //    source: 'updateUserSubscriptionStatus',
      //  },
      //);
      // Don't re-throw for webhook handlers to prevent webhook failures
      // Log the error and continue processing
      //console.error(
      //  `⚠️ Continuing webhook processing despite subscription status update failure`,
      //);
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
              (subscription.current_period_start ||
                subscription.start_date ||
                subscription.created) * 1000,
            ),
            current_period_end: new Date(
              (subscription.current_period_end || subscription.trial_end) *
                1000,
            ),
            next_billing_date: new Date(
              (subscription.current_period_end || subscription.trial_end) *
                1000,
            ),
          },
        });

        //console.log(
        //  `Subscription activated for garage: ${garageSubscription.garage.email}`,
        //);

        // 🆕 SEND SUBSCRIPTION WELCOME EMAIL
        await this.sendSubscriptionWelcomeEmail({
          garage: garageSubscription.garage,
          plan: garageSubscription.plan,
          subscription: subscription,
        });
      }
    } catch (error) {
      //console.error('Error handling subscription created:', error);
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
            (subscription.current_period_start ||
              subscription.start_date ||
              subscription.created) * 1000,
          ),
          current_period_end: new Date(
            (subscription.current_period_end || subscription.trial_end) * 1000,
          ),
          next_billing_date: new Date(
            (subscription.current_period_end || subscription.trial_end) * 1000,
          ),
          updated_at: new Date(),
        },
      });

      // Update user subscription visibility status
      await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

      console.log(
        `✅ Garage subscription activated: ${garageSubscription.garage.email} (Plan: ${garageSubscription.plan.name})`,
      );
    } catch (error) {
      //console.error('Error handling garage subscription created:', error);
    }
  }

  // Handle subscription updated
  async handleSubscriptionUpdated(subscription: any) {
    try {
      //console.log(
      //  `🔄 Subscription updated: ${subscription.id} (Status: ${subscription.status})`,
      //);

      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: { stripe_subscription_id: subscription.id },
          include: {
            garage: {
              select: {
                id: true,
                email: true,
                name: true,
                garage_name: true,
                billing_id: true,
              },
            },
            plan: {
              select: {
                name: true,
                price_pence: true,
                currency: true,
              },
            },
          },
        },
      );

      if (!garageSubscription) {
        //console.error(
        //  `❌ No garage subscription found for Stripe subscription: ${subscription.id}`,
        //);
        return;
      }

      // Store previous status for comparison
      const previousStatus = garageSubscription.status;
      const previousTrialEnd = garageSubscription.current_period_end;

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

      // Update subscription record
      await this.prisma.garageSubscription.update({
        where: { id: garageSubscription.id },
        data: {
          status: newStatus,
          current_period_start: new Date(
            (subscription.current_period_start ||
              subscription.start_date ||
              subscription.created) * 1000,
          ),
          current_period_end: new Date(
            (subscription.current_period_end || subscription.trial_end) * 1000,
          ),
          next_billing_date: new Date(
            (subscription.current_period_end || subscription.trial_end) * 1000,
          ),
          cancel_at: subscription.cancel_at
            ? new Date(subscription.cancel_at * 1000)
            : null,
          cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
          cancellation_reason:
            subscription.cancellation_details?.feedback || null,
          updated_at: new Date(),
        },
      });

      // 🆕 DETECT TRIAL-TO-PAID TRANSITION
      const isTrialToPaidTransition = this.detectTrialToPaidTransition({
        previousStatus,
        newStatus,
        previousTrialEnd,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        subscriptionStatus: subscription.status,
      });

      if (isTrialToPaidTransition) {
        //console.log(
        //  `🎉 Trial-to-paid transition detected for garage: ${garageSubscription.garage.email}`,
        //);
        await this.handleTrialToPaidTransition({
          garage: garageSubscription.garage,
          plan: garageSubscription.plan,
          subscription: subscription,
        });
      }

      // 🆕 DETECT TRIAL EXPIRATION
      const isTrialExpiration = this.detectTrialExpiration({
        previousStatus,
        newStatus,
        subscriptionStatus: subscription.status,
        subscriptionTrialEnd: subscription.trial_end,
      });

      if (isTrialExpiration) {
        //console.log(
        //  `⏰ Trial expiration detected for garage: ${garageSubscription.garage.email}`,
        //);
        await this.handleTrialExpiration({
          garage: garageSubscription.garage,
          plan: garageSubscription.plan,
          subscription: subscription,
        });
      }

      // Update user subscription visibility status
      await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

      //console.log(
      //  `✅ Subscription updated for garage: ${garageSubscription.garage.email} (Status: ${previousStatus} → ${newStatus})`,
      //);
    } catch (error) {
      //console.error('Error handling subscription updated:', error);
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

        //console.log(
        //  `✅ Subscription cancelled for garage: ${garageSubscription.garage.email}`,
        //);

        try {
          await this.notificationService.create({
            receiver_id: garageSubscription.garage.id,
            type: NotificationType.SUBSCRIPTION,
            text: `Your subscription to the "${garageSubscription.plan.name}" plan has been cancelled.`,
          });
        } catch (notificationError) {
          this.logger.error(
            'Failed to send subscription cancelled notification to garage:',
            notificationError,
          );
        }
      }
    } catch (error) {
      //console.error('Error handling subscription cancelled:', error);
    }
  }

  // Handle payment succeeded
  async handlePaymentSucceeded(invoice: any) {
    try {
      //console.log(
      //  `💳 Payment succeeded webhook received for invoice: ${invoice.id}, subscription: ${invoice.subscription}`,
      //);

      //console.log(invoice);

      let subscriptionId: string;
      if (typeof invoice.subscription === 'string') {
        subscriptionId = invoice.subscription;
      } else if (typeof invoice.subscription?.id === 'string') {
        subscriptionId = invoice.subscription.id;
      } else if (typeof invoice.lines?.data?.[0]?.subscription === 'string') {
        subscriptionId = invoice.lines.data[0].subscription;
      } else if (
        typeof (invoice as any).parent?.subscription_details?.subscription ===
        'string'
      ) {
        subscriptionId = (invoice as any).parent.subscription_details
          .subscription;
      }

      if (!subscriptionId) {
        //console.log(
        //  '⚠️ Could not determine subscription ID from invoice, skipping invoice creation.',
        //);
        return;
      }

      //console.log(
      //  `🔍 Looking for garage subscription with Stripe ID: ${subscriptionId}`,
      //);

      // Try to find garage subscription by stripe_subscription_id
      let garageSubscription = await this.prisma.garageSubscription.findFirst({
        where: { stripe_subscription_id: subscriptionId },
        include: { garage: true, plan: true },
      });

      // Fallback: If not found, try to find by metadata in Stripe subscription
      if (!garageSubscription) {
        //console.log(
        //  `⚠️ Garage subscription not found by stripe_subscription_id, trying to fetch from Stripe...`,
        //);
        try {
          const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const stripeSubscription =
            await Stripe.subscriptions.retrieve(subscriptionId);

          if (stripeSubscription?.metadata?.garage_subscription_id) {
            garageSubscription =
              await this.prisma.garageSubscription.findUnique({
                where: {
                  id: stripeSubscription.metadata.garage_subscription_id,
                },
                include: { garage: true, plan: true },
              });

            // Update stripe_subscription_id if it was missing
            if (
              garageSubscription &&
              !garageSubscription.stripe_subscription_id
            ) {
              await this.prisma.garageSubscription.update({
                where: { id: garageSubscription.id },
                data: { stripe_subscription_id: subscriptionId },
              });
              //console.log(
              //  `✅ Updated garage subscription with stripe_subscription_id: ${subscriptionId}`,
              //);
            }
          }
        } catch (error) {
          //console.error(
          //  `❌ Error fetching subscription from Stripe: ${error.message}`,
          //);
        }
      }

      if (!garageSubscription) {
        //console.error(
        //  `❌ No garage subscription found for Stripe subscription: ${subscriptionId}`,
        //);
        return;
      }

      //console.log(
      //  `✅ Found garage subscription: ${garageSubscription.id} for garage: ${garageSubscription.garage.email}`,
      //);

      // Check if invoice already exists for this payment
      const existingInvoice = await this.prisma.invoice.findFirst({
        where: {
          garage_id: garageSubscription.garage_id,
          // Check by amount and date to avoid duplicates
          amount: invoice.amount_paid / 100,
          created_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Within last 24 hours
          },
        },
      });

      if (existingInvoice) {
        //console.log(
        //  `⚠️ Invoice already exists for this payment: ${existingInvoice.invoice_number}`,
        //);
        return;
      }

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

      // 🆕 CREATE INVOICE FOR SUBSCRIPTION PAYMENT
      // Get full subscription details from Stripe for invoice
      let stripeSubscription = null;
      try {
        const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        stripeSubscription =
          await Stripe.subscriptions.retrieve(subscriptionId);
      } catch (error) {
        //console.warn(
        //  `⚠️ Could not fetch subscription details for invoice: ${error.message}`,
        //);
      }

      // Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber();
      //console.log(`📝 Generated invoice number: ${invoiceNumber}`);

      // Format membership period from subscription dates
      let membershipPeriod = null;
      if (
        stripeSubscription &&
        typeof stripeSubscription.current_period_start === 'number' &&
        typeof stripeSubscription.current_period_end === 'number'
      ) {
        const periodStart = new Date(
          stripeSubscription.current_period_start * 1000,
        );
        const periodEnd = new Date(
          stripeSubscription.current_period_end * 1000,
        );
        membershipPeriod = `${this.formatDate(periodStart)} - ${this.formatDate(
          periodEnd,
        )}`;
      } else if (
        invoice.lines?.data?.[0]?.period?.start &&
        invoice.lines?.data?.[0]?.period?.end
      ) {
        // Fallback to invoice line item period dates
        const periodStart = new Date(invoice.lines.data[0].period.start * 1000);
        const periodEnd = new Date(invoice.lines.data[0].period.end * 1000);
        membershipPeriod = `${this.formatDate(periodStart)} - ${this.formatDate(
          periodEnd,
        )}`;
      } else if (invoice.period_start && invoice.period_end) {
        // Fallback to invoice period dates
        const periodStart = new Date(invoice.period_start * 1000);
        const periodEnd = new Date(invoice.period_end * 1000);
        membershipPeriod = `${this.formatDate(periodStart)} - ${this.formatDate(
          periodEnd,
        )}`;
      }

      // Calculate due date (30 days from issue date)
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30);

      // Create invoice record
      // Note: For subscriptions, garage_id and driver_id are the same (garage paying for their own subscription)
      try {
        const createdInvoice = await this.prisma.invoice.create({
          data: {
            invoice_number: invoiceNumber,
            garage_id: garageSubscription.garage_id,
            driver_id: garageSubscription.garage_id, // Same as garage_id for subscriptions
            order_id: null, // No order for subscription invoices
            membership_period: membershipPeriod,
            issue_date: issueDate,
            due_date: dueDate,
            amount: invoice.amount_paid / 100, // Convert from cents to dollars
            status: 'PAID', // Payment already succeeded
          },
        });

        //console.log(
        //  `📄 ✅ Invoice created successfully: ${invoiceNumber} (ID: ${createdInvoice.id}) for garage: ${garageSubscription.garage.email}`,
        //);
      } catch (invoiceError) {
        //console.error(
        //  `❌ Error creating invoice: ${invoiceError.message}`,
        //  invoiceError,
        //);
        // Don't throw - continue with other operations
      }

      // Update user subscription visibility status
      // This will ensure has_subscription is true after successful payment
      await this.updateUserSubscriptionStatus(garageSubscription.garage_id);

      //console.log(
      //  `✅ Payment succeeded for garage: ${garageSubscription.garage.email} (Amount: ${invoice.amount_paid / 100} ${invoice.currency})`,
      //);

      // 🆕 SEND PAYMENT SUCCESS EMAIL
      await this.sendPaymentSuccessEmail({
        garage: garageSubscription.garage,
        plan: garageSubscription.plan,
        invoice: invoice,
        subscription: stripeSubscription,
      });

      try {
        await this.notificationService.create({
          receiver_id: garageSubscription.garage.id,
          type: NotificationType.SUBSCRIPTION,
          text: `Your payment for the "${garageSubscription.plan.name}" plan was successful.`,
        });
      } catch (notificationError) {
        this.logger.error(
          'Failed to send payment success notification to garage:',
          notificationError,
        );
      }
    } catch (error) {
      //console.error('❌ Error handling payment succeeded:', error);
      //console.error('Error stack:', error.stack);
    }
  }

  // Handle payment failed
  async handlePaymentFailed(invoice: any) {
    try {
      //console.log(
      //  `💳 Payment failed notification received for invoice: ${invoice.id}`,
      //);

      if (invoice.subscription) {
        const garageSubscription =
          await this.prisma.garageSubscription.findFirst({
            where: { stripe_subscription_id: invoice.subscription },
            include: {
              garage: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                  garage_name: true,
                  billing_id: true,
                },
              },
              plan: {
                select: {
                  name: true,
                  price_pence: true,
                  currency: true,
                },
              },
            },
          });

        if (garageSubscription) {
          // 🆕 ENHANCED PAYMENT RETRY LOGIC
          const gracePeriodDays = 3; // 3-day grace period
          const maxRetryAttempts = 3; // Maximum retry attempts
          const now = new Date();

          // Calculate retry attempt number based on how long subscription has been PAST_DUE
          const retryAttempt = this.calculateRetryAttempt(garageSubscription);
          const isFirstFailure = garageSubscription.status !== 'PAST_DUE';
          const isMaxRetriesReached = retryAttempt >= maxRetryAttempts;
          const isGracePeriodExpired = this.isGracePeriodExpired(
            garageSubscription,
            gracePeriodDays,
          );

          let newStatus: 'PAST_DUE' | 'SUSPENDED' = 'PAST_DUE';
          let shouldHideFromDrivers = true;
          let retryInfo = null;

          if (isFirstFailure) {
            // First failure - start grace period and retry tracking
            //console.log(
            //  `🕐 Starting ${gracePeriodDays}-day grace period for garage: ${garageSubscription.garage.email} (Retry attempt: 1/${maxRetryAttempts})`,
            //);
            shouldHideFromDrivers = false; // Keep visible during grace period
            retryInfo = {
              attempt: 1,
              max_attempts: maxRetryAttempts,
              next_retry_date: this.calculateNextRetryDate(1),
            };
          } else if (isMaxRetriesReached || isGracePeriodExpired) {
            // Maximum retries reached or grace period expired - suspend subscription
            newStatus = 'SUSPENDED';
            //console.log(
            //  `⏰ Maximum retries reached or grace period expired for garage: ${garageSubscription.garage.email} (Attempt ${retryAttempt}/${maxRetryAttempts}) - suspending subscription`,
            //);
            shouldHideFromDrivers = true;
            retryInfo = {
              attempt: retryAttempt,
              max_attempts: maxRetryAttempts,
              status: 'max_retries_reached',
              suspended_at: now.toISOString(),
            };
          } else {
            // Still in grace period with retries remaining
            const nextRetryDate = this.calculateNextRetryDate(retryAttempt);
            //console.log(
            //  `🔄 Grace period active for garage: ${garageSubscription.garage.email} (Retry attempt: ${retryAttempt}/${maxRetryAttempts}, Next retry: ${nextRetryDate.toISOString()})`,
            //);
            shouldHideFromDrivers = false;
            retryInfo = {
              attempt: retryAttempt,
              max_attempts: maxRetryAttempts,
              next_retry_date: nextRetryDate,
              grace_period_remaining: this.getGracePeriodRemainingDays(
                garageSubscription,
                gracePeriodDays,
              ),
            };
          }

          // Update subscription status
          await this.prisma.garageSubscription.update({
            where: { id: garageSubscription.id },
            data: {
              status: newStatus,
              updated_at: new Date(),
            },
          });

          // Update user subscription visibility status based on grace period
          await this.updateUserSubscriptionStatus(
            garageSubscription.garage_id,
            shouldHideFromDrivers,
          );

          // 🆕 SEND PAYMENT FAILURE NOTIFICATION EMAIL
          await this.sendPaymentFailureNotification({
            garage: garageSubscription.garage,
            plan: garageSubscription.plan,
            invoice: invoice,
            isFirstFailure: isFirstFailure,
            isGracePeriodExpired: isGracePeriodExpired,
            gracePeriodEnd: new Date(
              now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
            ),
            retryInfo: retryInfo,
          });

          //console.log(
          //  `❌ Payment failed for garage: ${garageSubscription.garage.email} (Amount: ${invoice.amount_due / 100} ${invoice.currency}) - Status: ${newStatus}`,
          //);

          try {
            const failureReason = this.getPaymentFailureReason(invoice);
            await this.notificationService.create({
              receiver_id: garageSubscription.garage.id,
              type: NotificationType.SUBSCRIPTION,
              text: `Your subscription payment of £${(invoice.amount_due / 100).toFixed(2)} for the "${garageSubscription.plan.name}" plan failed. Please update your payment method.`,
            });
          } catch (notificationError) {
            //console.error(
            //  'Failed to send payment failed notification to admins:',
            //  notificationError,
            //);
          }
        }
      }
    } catch (error) {
      //console.error('Error handling payment failed:', error);
    }
  }

  /**
   * Handle trial will end notification from Stripe
   * This webhook is triggered when a trial subscription is about to end
   *
   * @param subscription - Stripe subscription object
   */
  async handleTrialWillEnd(subscription: any) {
    try {
      //console.log(
      //  `⏰ Trial will end notification received for subscription: ${subscription.id}`,
      //);

      // Find the corresponding garage subscription
      const garageSubscription = await this.prisma.garageSubscription.findFirst(
        {
          where: { stripe_subscription_id: subscription.id },
          include: {
            garage: {
              select: {
                id: true,
                email: true,
                name: true,
                garage_name: true,
                billing_id: true,
              },
            },
            plan: {
              select: {
                name: true,
                price_pence: true,
                currency: true,
              },
            },
          },
        },
      );

      if (!garageSubscription) {
        //console.error(
        //  `❌ No garage subscription found for Stripe subscription: ${subscription.id}`,
        //);
        return;
      }

      // Calculate trial end date and days remaining
      const trialEndDate = new Date(subscription.trial_end * 1000);
      const now = new Date();
      const daysRemaining = Math.ceil(
        (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      //console.log(
      //  `📅 Trial ends on: ${trialEndDate.toISOString()}, Days remaining: ${daysRemaining}`,
      //);

      // Send trial warning email to garage owner
      await this.sendTrialWarningEmail({
        garage: garageSubscription.garage,
        plan: garageSubscription.plan,
        trialEndDate: trialEndDate,
        daysRemaining: daysRemaining,
      });

      //console.log(
      //  `✅ Trial warning email sent to garage: ${garageSubscription.garage.email}`,
      //);

      try {
        await this.notificationService.create({
          receiver_id: garageSubscription.garage.id,
          type: NotificationType.SUBSCRIPTION,
          text: `Your trial for the "${garageSubscription.plan.name}" plan is ending in ${daysRemaining} days. Please add a payment method to continue your subscription.`,
        });
      } catch (notificationError) {
        this.logger.error(
          'Failed to send trial ending notification to garage:',
          notificationError,
        );
      }
    } catch (error) {
      //console.error('Error handling trial will end:', error);
    }
  }

  /**
   * Send trial warning email to garage owner
   *
   * @param params - Email parameters
   */
  private async sendTrialWarningEmail(params: {
    garage: any;
    plan: any;
    trialEndDate: Date;
    daysRemaining: number;
  }) {
    try {
      const { garage, plan, trialEndDate, daysRemaining } = params;

      // Format price for display
      const priceFormatted = this.formatPrice(plan.price_pence, plan.currency);

      // Create billing portal URL for easy subscription management
      let billingPortalUrl = null;
      if (garage.billing_id) {
        try {
          const billingSession = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = billingSession.url;
        } catch (error) {
          //console.warn(
          //  `Could not create billing portal session for garage ${garage.id}:`,
          //  error.message,
          //);
        }
      }

      // Send email notification
      await this.mailService.sendTrialWarningEmail({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        price_formatted: priceFormatted,
        trial_end_date: trialEndDate.toLocaleDateString(),
        days_remaining: daysRemaining,
        billing_portal_url: billingPortalUrl,
      });

      //console.log(`📧 Trial warning email queued for garage: ${garage.email}`);
    } catch (error) {
      //console.error('Error sending trial warning email:', error);
    }
  }

  /**
   * Format price in pence to currency string
   *
   * @param pricePence - Price in pence
   * @param currency - Currency code
   * @returns Formatted price string
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
   * Detect if this is a trial-to-paid transition
   *
   * @param params - Transition detection parameters
   * @returns True if this is a trial-to-paid transition
   */
  private detectTrialToPaidTransition(params: {
    previousStatus: string;
    newStatus: string;
    previousTrialEnd: Date | null;
    currentPeriodEnd: Date;
    subscriptionStatus: string;
  }): boolean {
    const {
      previousStatus,
      newStatus,
      previousTrialEnd,
      currentPeriodEnd,
      subscriptionStatus,
    } = params;

    // Check if subscription status changed from trialing to active
    if (subscriptionStatus === 'active' && newStatus === 'ACTIVE') {
      // Check if this was previously in trial period
      if (previousTrialEnd && previousTrialEnd < currentPeriodEnd) {
        return true;
      }

      // Check if previous status was trialing
      if (previousStatus === 'ACTIVE' && subscriptionStatus === 'active') {
        // Additional check: if trial_end exists and is in the past
        return true;
      }
    }

    return false;
  }

  /**
   * Detect if this is a trial expiration (trial ended without payment)
   *
   * @param params - Expiration detection parameters
   * @returns True if this is a trial expiration
   */
  private detectTrialExpiration(params: {
    previousStatus: string;
    newStatus: string;
    subscriptionStatus: string;
    subscriptionTrialEnd: number | null;
  }): boolean {
    const {
      previousStatus,
      newStatus,
      subscriptionStatus,
      subscriptionTrialEnd,
    } = params;

    // Check if trial has ended and subscription is now inactive/cancelled
    if (subscriptionTrialEnd && subscriptionTrialEnd < Date.now() / 1000) {
      if (subscriptionStatus === 'canceled' || newStatus === 'CANCELLED') {
        return true;
      }

      if (subscriptionStatus === 'past_due' || newStatus === 'PAST_DUE') {
        return true;
      }
    }

    return false;
  }

  /**
   * Handle trial-to-paid transition
   * Send welcome email and update subscription details
   *
   * @param params - Transition parameters
   */
  private async handleTrialToPaidTransition(params: {
    garage: any;
    plan: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, subscription } = params;

      // Send trial-to-paid confirmation email
      await this.sendTrialToPaidConfirmationEmail({
        garage: garage,
        plan: plan,
        subscription: subscription,
      });

      //console.log(
      //  `📧 Trial-to-paid confirmation email sent to: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error handling trial-to-paid transition:', error);
    }
  }

  /**
   * Handle trial expiration
   * Send expiration notice and update subscription visibility
   *
   * @param params - Expiration parameters
   */
  private async handleTrialExpiration(params: {
    garage: any;
    plan: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, subscription } = params;

      // Send trial expiration email
      await this.sendTrialExpirationEmail({
        garage: garage,
        plan: plan,
        subscription: subscription,
      });

      //console.log(`📧 Trial expiration email sent to: ${garage.email}`);
    } catch (error) {
      //console.error('Error handling trial expiration:', error);
    }
  }

  /**
   * Send trial-to-paid confirmation email
   *
   * @param params - Email parameters
   */
  private async sendTrialToPaidConfirmationEmail(params: {
    garage: any;
    plan: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, subscription } = params;

      // Format price for display
      const priceFormatted = this.formatPrice(plan.price_pence, plan.currency);

      // Create billing portal URL
      let billingPortalUrl = null;
      if (garage.billing_id) {
        try {
          const billingSession = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = billingSession.url;
        } catch (error) {
          console.warn(
            `Could not create billing portal session for garage ${garage.id}:`,
            error.message,
          );
        }
      }

      // Send email notification
      await this.mailService.sendTrialToPaidConfirmationEmail({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        price_formatted: priceFormatted,
        next_billing_date: new Date(
          subscription.current_period_end * 1000,
        ).toLocaleDateString(),
        billing_portal_url: billingPortalUrl,
      });

      //console.log(
      //  `📧 Trial-to-paid confirmation email queued for garage: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error sending trial-to-paid confirmation email:', error);
    }
  }

  /**
   * Send trial expiration email
   *
   * @param params - Email parameters
   */
  private async sendTrialExpirationEmail(params: {
    garage: any;
    plan: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, subscription } = params;

      // Format price for display
      const priceFormatted = this.formatPrice(plan.price_pence, plan.currency);

      // Create billing portal URL for resubscription
      let billingPortalUrl = null;
      if (garage.billing_id) {
        try {
          const billingSession = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = billingSession.url;
        } catch (error) {
          console.warn(
            `Could not create billing portal session for garage ${garage.id}:`,
            error.message,
          );
        }
      }

      // Send email notification
      await this.mailService.sendTrialExpirationEmail({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        price_formatted: priceFormatted,
        billing_portal_url: billingPortalUrl,
      });

      //console.log(
      //  `📧 Trial expiration email queued for garage: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error sending trial expiration email:', error);
    }
  }

  /**
   * Send payment failure notification email
   *
   * @param params - Email parameters
   */
  private async sendPaymentFailureNotification(params: {
    garage: any;
    plan: any;
    invoice: any;
    isFirstFailure?: boolean;
    isGracePeriodExpired?: boolean;
    gracePeriodEnd?: Date;
    retryInfo?: any;
  }) {
    try {
      const { garage, plan, invoice } = params;

      // Format price for display
      const priceFormatted = this.formatPrice(plan.price_pence, plan.currency);

      // Determine failure reason from invoice
      const failureReason = this.getPaymentFailureReason(invoice);

      // Create billing portal URL for easy payment method update
      let billingPortalUrl = null;
      if (garage.billing_id) {
        try {
          const billingSession = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = billingSession.url;
        } catch (error) {
          //console.warn(
          //  `Could not create billing portal session for garage ${garage.id}:`,
          //  error.message,
          //);
        }
      }

      // Send email notification
      await this.mailService.sendPaymentFailureNotification({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        price_formatted: priceFormatted,
        failure_reason: failureReason,
        amount_due: (invoice.amount_due / 100).toFixed(2),
        currency: invoice.currency,
        billing_portal_url: billingPortalUrl,
        isFirstFailure: params.isFirstFailure,
        isGracePeriodExpired: params.isGracePeriodExpired,
        gracePeriodEnd: params.gracePeriodEnd,
        retryInfo: params.retryInfo,
      });

      //console.log(
      //  `📧 Payment failure notification email queued for garage: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error sending payment failure notification:', error);
    }
  }

  /**
   * Get human-readable payment failure reason
   *
   * @param invoice - Stripe invoice object
   * @returns Human-readable failure reason
   */
  private getPaymentFailureReason(invoice: any): string {
    // Check if there's a specific failure reason in the invoice
    if (invoice.last_payment_attempt?.failure_code) {
      const failureCode = invoice.last_payment_attempt.failure_code;
      const failureMessage = invoice.last_payment_attempt.failure_message || '';

      switch (failureCode) {
        case 'card_declined':
          return 'Your card was declined by your bank';
        case 'expired_card':
          return 'Your payment card has expired';
        case 'insufficient_funds':
          return 'Insufficient funds in your account';
        case 'incorrect_cvc':
          return 'Incorrect security code (CVC)';
        case 'processing_error':
          return 'Payment processing error occurred';
        case 'authentication_required':
          return 'Additional authentication required';
        default:
          return failureMessage || 'Payment could not be processed';
      }
    }

    // Default reason if no specific failure code
    return 'Payment could not be processed';
  }

  /**
   * Check if grace period has expired for a subscription
   *
   * @param subscription - Garage subscription object
   * @param gracePeriodDays - Number of days for grace period
   * @returns True if grace period has expired
   */
  private isGracePeriodExpired(
    subscription: any,
    gracePeriodDays: number,
  ): boolean {
    if (subscription.status !== 'PAST_DUE') {
      return false; // Not in grace period
    }

    const now = new Date();
    const gracePeriodEnd = new Date(
      subscription.updated_at.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
    );

    return now > gracePeriodEnd;
  }

  /**
   * Get remaining grace period days for a subscription
   *
   * @param subscription - Garage subscription object
   * @param gracePeriodDays - Number of days for grace period
   * @returns Number of days remaining in grace period
   */
  private getGracePeriodRemainingDays(
    subscription: any,
    gracePeriodDays: number,
  ): number {
    if (subscription.status !== 'PAST_DUE') {
      return 0; // Not in grace period
    }

    const now = new Date();
    const gracePeriodEnd = new Date(
      subscription.updated_at.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
    );
    const daysRemaining = Math.ceil(
      (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return Math.max(0, daysRemaining);
  }

  /**
   * Create billing portal session for payment method updates
   * Enhanced version that works with payment failure scenarios
   *
   * @param garageId - The ID of the garage user
   * @returns Billing portal session with payment failure context
   */
  async createPaymentMethodUpdateSession(garageId: string) {
    try {
      //console.log(
      //  `💳 Creating payment method update session for garage: ${garageId}`,
      //);

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
            select: {
              id: true,
              email: true,
              billing_id: true,
              garage_name: true,
            },
          },
          plan: {
            select: {
              name: true,
              price_pence: true,
              currency: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      if (!subscription) {
        throw new Error('No subscription found for garage');
      }

      if (!subscription.garage.billing_id) {
        throw new Error('No billing information found for garage');
      }

      // Create billing portal session
      const session = await StripePayment.createBillingSession(
        subscription.garage.billing_id,
      );

      // Add payment failure context if subscription is PAST_DUE
      const responseData: any = {
        url: session.url,
        garage: {
          id: subscription.garage.id,
          email: subscription.garage.email,
          garage_name: subscription.garage.garage_name,
        },
        subscription: {
          status: subscription.status,
          plan_name: subscription.plan.name,
          price_formatted: this.formatPrice(
            subscription.plan.price_pence,
            subscription.plan.currency,
          ),
        },
      };

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

      //console.log(
      //  `✅ Payment method update session created for garage: ${garageId}`,
      //);
      return responseData;
    } catch (error) {
      //console.error('Error creating payment method update session:', error);
      throw error;
    }
  }

  /**
   * Validate and update payment method for a garage
   * This method can be called after a user updates their payment method
   *
   * @param garageId - The ID of the garage user
   * @returns Validation result and updated subscription status
   */
  async validatePaymentMethodUpdate(garageId: string) {
    try {
      //console.log(
      //  `🔍 Validating payment method update for garage: ${garageId}`,
      //);

      // Get garage's current subscription
      const subscription = await this.prisma.garageSubscription.findFirst({
        where: {
          garage_id: garageId,
          status: {
            in: ['PAST_DUE', 'SUSPENDED'], // Focus on failed payment subscriptions
          },
        },
        include: {
          garage: {
            select: {
              id: true,
              email: true,
              billing_id: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      if (!subscription || !subscription.garage.billing_id) {
        throw new Error('No subscription or billing information found');
      }

      // Check if payment method is valid in Stripe
      let isValidPaymentMethod = false;
      try {
        const customer = await StripePayment.getCustomerByID(
          subscription.garage.billing_id,
        );
        isValidPaymentMethod =
          customer && !!customer.invoice_settings?.default_payment_method;
      } catch (error) {
        console.warn(
          `Could not validate payment method for garage ${garageId}:`,
          error.message,
        );
      }

      // If payment method is valid and subscription was PAST_DUE, reactivate it
      if (isValidPaymentMethod && subscription.status === 'PAST_DUE') {
        // Update subscription status back to ACTIVE
        await this.prisma.garageSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            updated_at: new Date(),
          },
        });

        // Update user subscription visibility status
        await this.updateUserSubscriptionStatus(subscription.garage_id); // Use default visibility logic

        //console.log(
        //  `✅ Payment method validated and subscription reactivated for garage: ${garageId}`,
        //);

        return {
          success: true,
          message:
            'Payment method updated successfully and subscription reactivated',
          subscription_reactivated: true,
        };
      }

      return {
        success: true,
        message: isValidPaymentMethod
          ? 'Payment method is valid'
          : 'Payment method update needed',
        subscription_reactivated: false,
      };
    } catch (error) {
      //console.error('Error validating payment method update:', error);
      throw error;
    }
  }

  /**
   * Calculate retry attempt number based on subscription status and timing
   *
   * @param subscription - Garage subscription object
   * @returns Current retry attempt number
   */
  private calculateRetryAttempt(subscription: any): number {
    if (subscription.status !== 'PAST_DUE') {
      return 0; // Not in retry period
    }

    // Calculate retry attempt based on how long subscription has been PAST_DUE
    const now = new Date();
    const timeSinceFirstFailure =
      now.getTime() - subscription.updated_at.getTime();
    const hoursSinceFailure = timeSinceFirstFailure / (1000 * 60 * 60);

    // Retry schedule: 24h, 48h, 72h (attempts 1, 2, 3)
    if (hoursSinceFailure < 24) {
      return 1; // First retry attempt
    } else if (hoursSinceFailure < 48) {
      return 2; // Second retry attempt
    } else if (hoursSinceFailure < 72) {
      return 3; // Third retry attempt
    } else {
      return 4; // Beyond max retries
    }
  }

  /**
   * Calculate next retry date based on current attempt
   *
   * @param attempt - Current retry attempt number
   * @returns Next retry date
   */
  private calculateNextRetryDate(attempt: number): Date {
    const now = new Date();

    switch (attempt) {
      case 1:
        // Next retry in 24 hours
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case 2:
        // Next retry in 48 hours (24 hours from now)
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case 3:
        // Final retry in 24 hours
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      default:
        // No more retries
        return now;
    }
  }

  /**
   * Get retry statistics for monitoring and analytics
   *
   * @returns Retry statistics
   */
  async getRetryStatistics() {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get retry statistics
      const [totalFailures, firstFailures, maxRetriesReached, recovered] =
        await Promise.all([
          // Total payment failures in last 30 days
          this.prisma.garageSubscription.count({
            where: {
              status: 'PAST_DUE',
              updated_at: {
                gte: thirtyDaysAgo,
              },
            },
          }),

          // First failures (new PAST_DUE subscriptions)
          this.prisma.garageSubscription.count({
            where: {
              status: 'PAST_DUE',
              updated_at: {
                gte: thirtyDaysAgo,
              },
              // This is a simplified approach - in a real system you'd track first failures differently
            },
          }),

          // Subscriptions that reached max retries (SUSPENDED due to payment failure)
          this.prisma.garageSubscription.count({
            where: {
              status: 'SUSPENDED',
              updated_at: {
                gte: thirtyDaysAgo,
              },
            },
          }),

          // Recovered subscriptions (went from PAST_DUE back to ACTIVE)
          this.prisma.garageSubscription.count({
            where: {
              status: 'ACTIVE',
              updated_at: {
                gte: thirtyDaysAgo,
              },
              // This is a simplified approach - in a real system you'd track recovery differently
            },
          }),
        ]);

      const recoveryRate =
        totalFailures > 0 ? (recovered / totalFailures) * 100 : 0;
      const suspensionRate =
        totalFailures > 0 ? (maxRetriesReached / totalFailures) * 100 : 0;

      return {
        total_payment_failures_30_days: totalFailures,
        first_failures: firstFailures,
        max_retries_reached: maxRetriesReached,
        recovered_subscriptions: recovered,
        recovery_rate: Math.round(recoveryRate * 100) / 100,
        suspension_rate: Math.round(suspensionRate * 100) / 100,
        period: '30_days',
        generated_at: now.toISOString(),
      };
    } catch (error) {
      console.error('Error generating retry statistics:', error);
      return null;
    }
  }

  /**
   * Get transition reason for status changes
   *
   * @param subscription - Garage subscription object
   * @param hasSubscription - Whether garage has active subscription
   * @returns Human-readable transition reason
   */
  private getTransitionReason(
    subscription: any,
    hasSubscription: boolean,
  ): string {
    if (!subscription) {
      return 'no_subscription_found';
    }

    if (subscription.status === 'ACTIVE' && hasSubscription) {
      return 'active_subscription_visible';
    }

    if (subscription.status === 'PAST_DUE' && hasSubscription) {
      return 'past_due_grace_period_visible';
    }

    if (subscription.status === 'PAST_DUE' && !hasSubscription) {
      return 'past_due_grace_period_expired_hidden';
    }

    if (subscription.status === 'SUSPENDED') {
      return 'subscription_suspended_hidden';
    }

    if (subscription.status === 'CANCELLED') {
      return 'subscription_cancelled_hidden';
    }

    if (subscription.status === 'INACTIVE') {
      return 'subscription_inactive_hidden';
    }

    return 'unknown_status_change';
  }

  /**
   * Get comprehensive subscription analytics for monitoring
   *
   * @returns Subscription analytics data
   */
  async getSubscriptionAnalytics() {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get comprehensive subscription statistics
      const [
        totalSubscriptions,
        activeSubscriptions,
        pastDueSubscriptions,
        suspendedSubscriptions,
        cancelledSubscriptions,
        inactiveSubscriptions,
        trialSubscriptions,
        paidSubscriptions,
      ] = await Promise.all([
        // Total subscriptions
        this.prisma.garageSubscription.count({
          where: {
            created_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Active subscriptions
        this.prisma.garageSubscription.count({
          where: {
            status: 'ACTIVE',
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Past due subscriptions
        this.prisma.garageSubscription.count({
          where: {
            status: 'PAST_DUE',
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Suspended subscriptions
        this.prisma.garageSubscription.count({
          where: {
            status: 'SUSPENDED',
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Cancelled subscriptions
        this.prisma.garageSubscription.count({
          where: {
            status: 'CANCELLED',
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Inactive subscriptions
        this.prisma.garageSubscription.count({
          where: {
            status: 'INACTIVE',
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Trial subscriptions (active with Stripe subscription ID)
        this.prisma.garageSubscription.count({
          where: {
            status: 'ACTIVE',
            stripe_subscription_id: {
              not: null,
            },
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),

        // Paid subscriptions (active without trial indicators)
        this.prisma.garageSubscription.count({
          where: {
            status: 'ACTIVE',
            stripe_subscription_id: null,
            updated_at: {
              gte: thirtyDaysAgo,
            },
          },
        }),
      ]);

      // Calculate health metrics
      const totalActive = activeSubscriptions + pastDueSubscriptions;
      const healthRate =
        totalSubscriptions > 0
          ? (activeSubscriptions / totalSubscriptions) * 100
          : 0;
      const churnRate =
        totalSubscriptions > 0
          ? ((suspendedSubscriptions + cancelledSubscriptions) /
              totalSubscriptions) *
            100
          : 0;
      const trialConversionRate =
        trialSubscriptions > 0
          ? (paidSubscriptions / trialSubscriptions) * 100
          : 0;

      return {
        period: '30_days',
        generated_at: now.toISOString(),

        // Subscription counts
        total_subscriptions: totalSubscriptions,
        active_subscriptions: activeSubscriptions,
        past_due_subscriptions: pastDueSubscriptions,
        suspended_subscriptions: suspendedSubscriptions,
        cancelled_subscriptions: cancelledSubscriptions,
        inactive_subscriptions: inactiveSubscriptions,

        // Subscription types
        trial_subscriptions: trialSubscriptions,
        paid_subscriptions: paidSubscriptions,

        // Health metrics
        health_rate: Math.round(healthRate * 100) / 100,
        churn_rate: Math.round(churnRate * 100) / 100,
        trial_conversion_rate: Math.round(trialConversionRate * 100) / 100,

        // Status distribution
        status_distribution: {
          active: activeSubscriptions,
          past_due: pastDueSubscriptions,
          suspended: suspendedSubscriptions,
          cancelled: cancelledSubscriptions,
          inactive: inactiveSubscriptions,
        },

        // Business metrics
        revenue_impact: {
          active_revenue_potential: activeSubscriptions,
          at_risk_revenue: pastDueSubscriptions,
          lost_revenue: suspendedSubscriptions + cancelledSubscriptions,
        },
      };
    } catch (error) {
      console.error('Error generating subscription analytics:', error);
      return null;
    }
  }

  /**
   * Send subscription welcome email
   * Helper method to format and send welcome email for new subscriptions
   *
   * @param params - Email parameters
   */
  private async sendSubscriptionWelcomeEmail(params: {
    garage: any;
    plan: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, subscription } = params;

      // Format price for display
      const priceFormatted = this.formatPrice(plan.price_pence, plan.currency);

      // Calculate next billing date
      const nextBillingDate = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toLocaleDateString()
        : null;

      // Get billing portal URL
      let billingPortalUrl = null;
      try {
        if (garage.billing_id) {
          const session = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = session.url;
        }
      } catch (error) {
        console.warn(
          `Could not create billing portal session for garage ${garage.id}:`,
          error.message,
        );
      }

      // Send email notification
      await this.mailService.sendSubscriptionWelcomeEmail({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        price_formatted: priceFormatted,
        currency: plan.currency,
        next_billing_date: nextBillingDate,
        billing_portal_url: billingPortalUrl,
      });

      //console.log(
      //  `📧 Subscription welcome email queued for garage: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error sending subscription welcome email:', error);
    }
  }

  /**
   * Send payment success email
   * Helper method to format and send payment success confirmation
   *
   * @param params - Email parameters
   */
  private async sendPaymentSuccessEmail(params: {
    garage: any;
    plan: any;
    invoice: any;
    subscription: any;
  }) {
    try {
      const { garage, plan, invoice, subscription } = params;

      // Format payment amount
      const amountPaid = (invoice.amount_paid / 100).toFixed(2);

      // Format payment date
      const paymentDate = new Date(invoice.created * 1000).toLocaleDateString();

      // Calculate billing period
      const billingPeriod =
        subscription.current_period_start && subscription.current_period_end
          ? `${new Date(subscription.current_period_start * 1000).toLocaleDateString()} - ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`
          : 'Current billing period';

      // Get payment method information
      const paymentMethod =
        invoice.payment_intent?.charges?.data?.[0]?.payment_method_details
          ?.type || 'Card';

      // Calculate next billing date
      const nextBillingDate = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toLocaleDateString()
        : null;

      const nextBillingAmount = this.formatPrice(
        plan.price_pence,
        plan.currency,
      );

      // Get billing portal URL
      let billingPortalUrl = null;
      try {
        if (garage.billing_id) {
          const session = await StripePayment.createBillingSession(
            garage.billing_id,
          );
          billingPortalUrl = session.url;
        }
      } catch (error) {
        console.warn(
          `Could not create billing portal session for garage ${garage.id}:`,
          error.message,
        );
      }

      // Send email notification
      await this.mailService.sendPaymentSuccessEmail({
        to: garage.email,
        garage_name: garage.garage_name || garage.name,
        plan_name: plan.name,
        amount_paid: amountPaid,
        currency: invoice.currency,
        payment_date: paymentDate,
        billing_period: billingPeriod,
        payment_method: paymentMethod,
        transaction_id: invoice.id,
        next_billing_date: nextBillingDate,
        next_billing_amount: nextBillingAmount,
        billing_portal_url: billingPortalUrl,
      });

      //console.log(
      //  `📧 Payment success email queued for garage: ${garage.email}`,
      //);
    } catch (error) {
      //console.error('Error sending payment success email:', error);
    }
  }

  /**
   * Generate unique invoice number
   * Format: INV-YYYYMMDD-XXXX (e.g., INV-20250115-0001)
   *
   * @returns Unique invoice number
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const datePrefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    // Find the highest sequence number for today
    const todayInvoices = await this.prisma.invoice.findMany({
      where: {
        invoice_number: {
          startsWith: datePrefix,
        },
      },
      orderBy: {
        invoice_number: 'desc',
      },
      take: 1,
    });

    let sequence = 1;
    if (todayInvoices.length > 0) {
      const lastInvoiceNumber = todayInvoices[0].invoice_number;
      const lastSequence = parseInt(lastInvoiceNumber.split('-')[2] || '0', 10);
      sequence = lastSequence + 1;
    }

    return `${datePrefix}-${String(sequence).padStart(4, '0')}`;
  }

  /**
   * Format date for membership period display
   * Format: "MMM DD, YYYY" (e.g., "Jan 15, 2025")
   *
   * @param date - Date to format
   * @returns Formatted date string
   */
  private formatDate(date: Date): string {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
}
