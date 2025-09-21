import { Controller, Post, Req, Headers } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { Request } from 'express';
import { TransactionRepository } from '../../../common/repository/transaction/transaction.repository';

@Controller('payment/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    try {
      const payload = req.rawBody.toString();
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
          console.log('Product created:', event.data.object);
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
