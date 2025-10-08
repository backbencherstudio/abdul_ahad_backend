import { Controller, Post, Req, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { Request } from 'express';
import { TransactionRepository } from '../../../common/repository/transaction/transaction.repository';

@ApiTags('Stripe Webhooks')
@Controller('payment/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('webhook')
  @ApiOperation({
    summary: 'Handle Stripe webhook events',
    description: `
      Processes incoming Stripe webhook events for subscription management.
      
      **Supported Events:**
      - \`customer.subscription.created\` - New subscription activated
      - \`customer.subscription.updated\` - Subscription status changes
      - \`customer.subscription.deleted\` - Subscription cancelled
      - \`customer.subscription.trial_will_end\` - Trial ending soon
      - \`invoice.payment_succeeded\` - Payment processed successfully
      - \`invoice.payment_failed\` - Payment failed with retry logic
      - \`payment_intent.succeeded\` - Direct payment succeeded
      - \`payment_intent.payment_failed\` - Direct payment failed
      
      **Features:**
      - Automatic subscription activation/deactivation
      - Trial period management with email notifications
      - Payment failure recovery with grace periods
      - Smart retry logic for failed payments
      - Professional email notifications
      - Subscription visibility management
    `,
  })
  @ApiHeader({
    name: 'stripe-signature',
    description: 'Stripe webhook signature for request verification',
    required: true,
    example: 't=1234567890,v1=signature_hash_here',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        received: {
          type: 'boolean',
          example: true,
          description: 'Indicates if webhook was processed successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook signature or payload',
    schema: {
      type: 'object',
      properties: {
        received: {
          type: 'boolean',
          example: false,
          description: 'Indicates webhook processing failed',
        },
        error: {
          type: 'string',
          example: 'Invalid signature',
          description: 'Error message describing the failure',
        },
      },
    },
  })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    try {
      const payload = req.body.toString();
      const event = await this.stripeService.handleWebhook(payload, signature);

      // Handle events
      switch (event.type) {
        // ✅ EXISTING: Payment Intent Events (KEEP YOUR EXISTING CODE)
        case 'customer.created':
          break;
        case 'payment_intent.created':
          break;
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          // create tax transaction
          // await StripePayment.createTaxTransaction(
          //   paymentIntent.metadata['tax_calculation'],
          // );
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: paymentIntent.id,
            status: 'succeeded',
            paid_amount: paymentIntent.amount / 100, // amount in dollars
            paid_currency: paymentIntent.currency,
            raw_status: paymentIntent.status,
          });
          break;
        case 'payment_intent.payment_failed':
          const failedPaymentIntent = event.data.object;
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: failedPaymentIntent.id,
            status: 'failed',
            raw_status: failedPaymentIntent.status,
          });
          break;
        case 'payment_intent.canceled':
          const canceledPaymentIntent = event.data.object;
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: canceledPaymentIntent.id,
            status: 'canceled',
            raw_status: canceledPaymentIntent.status,
          });
          break;
        case 'payment_intent.requires_action':
          const requireActionPaymentIntent = event.data.object;
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: requireActionPaymentIntent.id,
            status: 'requires_action',
            raw_status: requireActionPaymentIntent.status,
          });
          break;
        case 'payout.paid':
          const paidPayout = event.data.object;
          console.log(paidPayout);
          break;
        case 'payout.failed':
          const failedPayout = event.data.object;
          console.log(failedPayout);
          break;

        // ✅ NEW: Subscription Events (ADDED TO YOUR EXISTING CODE)
        case 'product.created':
        case 'plan.created': // Handle both product and plan events
          console.log('Product/Plan created:', event.data.object);
          break;

        case 'price.created':
          console.log('Price created:', event.data.object);
          break;

        case 'customer.subscription.created':
          console.log('Subscription created:', event.data.object);
          await this.stripeService.handleSubscriptionCreated(event.data.object);
          break;

        case 'customer.subscription.updated':
          console.log('Subscription updated:', event.data.object);
          await this.stripeService.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          console.log('Subscription cancelled:', event.data.object);
          await this.stripeService.handleSubscriptionCancelled(
            event.data.object,
          );
          break;

        case 'invoice.payment_succeeded':
          console.log('Payment succeeded:', event.data.object);
          await this.stripeService.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          console.log('Payment failed:', event.data.object);
          await this.stripeService.handlePaymentFailed(event.data.object);
          break;

        case 'customer.subscription.trial_will_end':
          console.log('Trial will end:', event.data.object);
          await this.stripeService.handleTrialWillEnd(event.data.object);
          break;

        case 'billing_portal.session.created':
          console.log('Billing portal session created:', event.data.object);
          // No action needed - this is just informational
          break;

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      console.error('Webhook error', error);
      return { received: false };
    }
  }
}
