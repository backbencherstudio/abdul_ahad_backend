import stripe from 'stripe';
import * as fs from 'fs';
import appConfig from '../../../../config/app.config';
import { Fetch } from '../../Fetch';

const STRIPE_SECRET_KEY = appConfig().payment.stripe.secret_key;

const Stripe = new stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
});

const STRIPE_WEBHOOK_SECRET = appConfig().payment.stripe.webhook_secret;
/**
 * Stripe payment method helper
 */
export class StripePayment {
  static async createPaymentMethod({
    card,
    billing_details,
  }: {
    card: stripe.PaymentMethodCreateParams.Card;
    billing_details: stripe.PaymentMethodCreateParams.BillingDetails;
  }): Promise<stripe.PaymentMethod> {
    const paymentMethod = await Stripe.paymentMethods.create({
      card: {
        number: card.number,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        cvc: card.cvc,
      },
      billing_details: billing_details,
    });
    return paymentMethod;
  }

  /**
   * Add customer to stripe
   * @param email
   * @returns
   */
  static async createCustomer({
    user_id,
    name,
    email,
  }: {
    user_id: string;
    name: string;
    email: string;
  }): Promise<stripe.Customer> {
    const customer = await Stripe.customers.create({
      name: name,
      email: email,
      metadata: {
        user_id: user_id,
      },
      description: 'New Customer',
    });
    return customer;
  }

  static async attachCustomerPaymentMethodId({
    customer_id,
    payment_method_id,
  }: {
    customer_id: string;
    payment_method_id: string;
  }): Promise<stripe.PaymentMethod> {
    const customer = await Stripe.paymentMethods.attach(payment_method_id, {
      customer: customer_id,
    });
    return customer;
  }

  static async setCustomerDefaultPaymentMethodId({
    customer_id,
    payment_method_id,
  }: {
    customer_id: string;
    payment_method_id: string;
  }): Promise<stripe.Customer> {
    const customer = await Stripe.customers.update(customer_id, {
      invoice_settings: {
        default_payment_method: payment_method_id,
      },
    });
    return customer;
  }

  static async updateCustomer({
    customer_id,
    name,
    email,
  }: {
    customer_id: string;
    name: string;
    email: string;
  }): Promise<stripe.Customer> {
    const customer = await Stripe.customers.update(customer_id, {
      name: name,
      email: email,
    });
    return customer;
  }

  /**
   * Update customer metadata for ban/unban status management
   * @param customer_id - Stripe customer ID
   * @param metadata - Metadata to update
   * @returns Updated customer object
   */
  static async updateCustomerMetadata({
    customer_id,
    metadata,
  }: {
    customer_id: string;
    metadata: stripe.MetadataParam;
  }): Promise<stripe.Customer> {
    try {
      const customer = await Stripe.customers.update(customer_id, {
        metadata: metadata,
      });
      return customer;
    } catch (error) {
      console.error('Error updating customer metadata:', error);
      throw new Error('Failed to update customer metadata: ' + error.message);
    }
  }

  /**
   * Get customer using id
   * @param id
   * @returns
   */
  static async getCustomerByID(id: string): Promise<stripe.Customer> {
    const customer = await Stripe.customers.retrieve(id);
    return customer as stripe.Customer;
  }

  /**
   * Get active subscriptions for a customer
   * @param customer_id - Stripe customer ID
   * @returns Array of active subscriptions
   */
  static async getActiveSubscriptions(
    customer_id: string,
  ): Promise<stripe.Subscription[]> {
    try {
      const subscriptions = await Stripe.subscriptions.list({
        customer: customer_id,
        status: 'active',
        limit: 100, // Get up to 100 active subscriptions
      });
      return subscriptions.data;
    } catch (error) {
      console.error('Error fetching active subscriptions:', error);
      throw new Error('Failed to fetch active subscriptions: ' + error.message);
    }
  }

  /**
   * Validate if customer exists in Stripe
   * @param customerId
   * @returns
   */
  static async validateCustomer(customerId: string): Promise<boolean> {
    try {
      await Stripe.customers.retrieve(customerId);
      return true;
    } catch (error) {
      if (error.code === 'resource_missing') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create billing portal session
   * @param customer
   * @returns
   */
  static async createBillingSession(customer: string) {
    const session = await Stripe.billingPortal.sessions.create({
      customer: customer,
      return_url: appConfig().app.url,
    });
    return session;
  }

  static async createPaymentIntent({
    amount,
    currency,
    customer_id,
    metadata,
  }: {
    amount: number;
    currency: string;
    customer_id: string;
    metadata?: stripe.MetadataParam;
  }): Promise<stripe.PaymentIntent> {
    return Stripe.paymentIntents.create({
      amount: amount * 100, // amount in cents
      currency: currency,
      customer: customer_id,
      metadata: metadata,
    });
  }

  /**
   * Create stripe hosted checkout session
   * @param customer
   * @param price
   * @returns
   */
  static async createCheckoutSession() {
    const success_url = `${
      appConfig().app.url
    }/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${appConfig().app.url}/failed`;

    const session = await Stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Sample Product',
            },
            unit_amount: 2000, // $20.00
          },
          quantity: 1,
        },
      ],

      success_url: success_url,
      cancel_url: cancel_url,
      // automatic_tax: { enabled: true },
    });
    return session;
  }

  /**
   * Create stripe hosted checkout session
   * @param customer
   * @param price
   * @param trial_period_days - Optional trial period in days (0 = no trial)
   * @returns
   */
  static async createCheckoutSessionSubscription(
    customer: string,
    price: string,
    trial_period_days?: number,
  ) {
    const success_url = `${
      appConfig().app.url
    }/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${appConfig().app.url}/failed`;

    // Get default trial period from environment or use 14 days
    const defaultTrialDays = parseInt(
      process.env.DEFAULT_TRIAL_PERIOD_DAYS || '14',
      10,
    );
    const trialDays =
      trial_period_days !== undefined ? trial_period_days : defaultTrialDays;

    const session = await Stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customer,
      line_items: [
        {
          price: price,
          quantity: 1,
        },
      ],
      subscription_data: {
        ...(trialDays > 0 && { trial_period_days: trialDays }),
      },
      success_url: success_url,
      cancel_url: cancel_url,
      // automatic_tax: { enabled: true },
    });
    return session;
  }

  /**
   * Create stripe hosted checkout session with metadata for garage subscriptions
   * @param customer
   * @param price
   * @param metadata
   * @param success_url
   * @param cancel_url
   * @returns
   */
  static async createCheckoutSessionSubscriptionWithMetadata({
    customer,
    price,
    metadata,
    success_url,
    cancel_url,
    trial_period_days,
  }: {
    customer: string;
    price: string;
    metadata: stripe.MetadataParam;
    success_url?: string;
    cancel_url?: string;
    trial_period_days?: number;
  }) {
    const defaultSuccessUrl = `${
      appConfig().app.url
    }/success?session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancelUrl = `${appConfig().app.url}/failed`;

    // Get default trial period from environment or use 14 days
    const defaultTrialDays = parseInt(
      process.env.DEFAULT_TRIAL_PERIOD_DAYS || '14',
      10,
    );
    const trialDays =
      trial_period_days !== undefined ? trial_period_days : defaultTrialDays;

    const session = await Stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customer,
      line_items: [
        {
          price: price,
          quantity: 1,
        },
      ],
      subscription_data: {
        ...(trialDays > 0 && { trial_period_days: trialDays }),
        metadata: metadata,
      },
      success_url: success_url || defaultSuccessUrl,
      cancel_url: cancel_url || defaultCancelUrl,
    });
    return session;
  }

  /**
   * Calculate taxes
   * @param amount
   * @returns
   */
  static async calculateTax({
    amount,
    currency,
    customer_details,
  }: {
    amount: number;
    currency: string;
    customer_details: stripe.Tax.CalculationCreateParams.CustomerDetails;
  }): Promise<stripe.Tax.Calculation> {
    const taxCalculation = await Stripe.tax.calculations.create({
      currency: currency,
      customer_details: customer_details,
      line_items: [
        {
          amount: amount * 100,
          tax_behavior: 'exclusive',
          reference: 'tax_calculation',
        },
      ],
    });
    return taxCalculation;
  }

  // create a tax transaction
  static async createTaxTransaction(
    tax_calculation: string,
  ): Promise<stripe.Tax.Transaction> {
    const taxTransaction = await Stripe.tax.transactions.createFromCalculation({
      calculation: tax_calculation,
      reference: 'tax_transaction',
    });
    return taxTransaction;
  }

  // download invoice using payment intent id
  static async downloadInvoiceUrl(
    payment_intent_id: string,
  ): Promise<string | null> {
    const invoice = await Stripe.invoices.retrieve(payment_intent_id);
    // check if the invoice has  areceipt url
    if (invoice.hosted_invoice_url) {
      return invoice.hosted_invoice_url;
    }
    return null;
  }

  // download invoice using payment intent id
  static async downloadInvoiceFile(payment_intent_id: string) {
    const invoice = await Stripe.invoices.retrieve(payment_intent_id);

    if (invoice.hosted_invoice_url) {
      const response = await Fetch.get(invoice.hosted_invoice_url, {
        responseType: 'stream',
      });

      // save the response to a file
      return fs.writeFileSync('receipt.pdf', response.data);
    } else {
      return null;
    }
  }

  // send invoice to email using payment intent id
  static async sendInvoiceToEmail(payment_intent_id: string) {
    const invoice = await Stripe.invoices.sendInvoice(payment_intent_id);
    return invoice;
  }

  // -----------------------payout system start--------------------------------

  // If you are paying users, they need Stripe Connect accounts. You can create Express or Standard accounts.
  static async createConnectedAccount(email: string) {
    const connectedAccount = await Stripe.accounts.create({
      type: 'express',
      email: email,
      country: 'US', // change as per user's country
      // business_profile: {
      //   url: appConfig().app.url,
      // },
      // settings: {
      //   payouts: {
      //     schedule: {
      //       interval: 'manual',
      //     },
      //   },
      // },
      capabilities: {
        // card_payments: {
        //   enabled: true,
        // },
        transfers: {
          // enabled: true,
          requested: true,
        },
      },
    });

    return connectedAccount;
  }

  // Before making payouts, users must complete Stripe Connect onboarding.
  static async createOnboardingAccountLink(account_id: string) {
    const accountLink = await Stripe.accountLinks.create({
      account: account_id,
      refresh_url: appConfig().app.url,
      return_url: appConfig().app.url,
      type: 'account_onboarding',
    });

    return accountLink;
  }

  // transfer money to account
  static async createTransfer(
    account_id: string,
    amount: number,
    currency: string,
  ) {
    const transfer = await Stripe.transfers.create({
      amount: amount * 100,
      currency: currency,
      destination: account_id,
    });
    return transfer;
  }

  // Once the user has an approved Stripe account with a linked bank, you can send them funds.
  static async createPayout(
    account_id: string,
    amount: number,
    currency: string,
  ) {
    const payout = await Stripe.payouts.create(
      {
        amount: amount * 100, // amount in cents
        currency: currency,
      },
      {
        stripeAccount: account_id, // context of connected account
      },
    );

    return payout;
  }

  // check balance of account
  static async checkBalance(account_id: string) {
    const balance = await Stripe.balance.retrieve({
      stripeAccount: account_id,
    });
    return balance;
  }

  // static async createPayout(amount: number, currency: string) {
  //   const payout = await Stripe.payouts.create({
  //     amount: amount * 100,
  //     currency: currency,
  //   });
  //   return payout;
  // }
  // -----------------------payout system end--------------------------------

  // ACH payment
  static async createToken() {
    const token = await Stripe.tokens.create({
      bank_account: {
        country: 'US',
        currency: 'usd',
        routing_number: '110000000',
        account_number: '000123456789',
        account_holder_name: 'Jane Doe',
        account_holder_type: 'individual',
      },
    });
    return token;
  }

  static async createBankAccount(customerId: string, bankAccountToken: string) {
    const bankAccount = await Stripe.customers.createSource(customerId, {
      source: bankAccountToken,
    });
    return bankAccount;
  }

  static async verifyBankAccount(
    customerId: string,
    bankAccountId: string,
    amounts: [number, number],
  ) {
    return Stripe.customers.verifySource(customerId, bankAccountId, {
      amounts,
    });
  }

  static async createACHPaymentIntent(customerId: string, amount: number) {
    return await Stripe.paymentIntents.create({
      amount: amount * 100,
      currency: 'usd',
      customer: customerId,
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          verification_method: 'automatic',
        },
      },
    });
    // return await Stripe.checkout.sessions.create({
    //   mode: 'payment',
    //   customer: customerId,
    //   payment_method_types: ['card', 'us_bank_account'],
    //   payment_method_options: {
    //     us_bank_account: {
    //       verification_method: 'automatic',
    //     },
    //   },
    //   line_items: [
    //     {
    //       price_data: {
    //         currency: 'usd',
    //         unit_amount: amount * 100,
    //         product_data: {
    //           name: 'T-shirt',
    //         },
    //       },
    //       quantity: 1,
    //     },
    //   ],
    //   success_url: 'https://example.com/success',
    //   cancel_url: 'https://example.com/cancel',
    // });
  }
  // end ACH

  // Create or reuse a Stripe Product
  static async createProduct({
    name,
    active,
  }: {
    name: string;
    active: boolean;
  }): Promise<stripe.Product> {
    // Stripe has no product-by-name fetch API; create a new product each sync
    // If you want idempotency per name, you can store product_id in DB later.
    const product = await Stripe.products.create({
      name,
      active,
    });
    return product;
  }

  // Create a recurring Price for a product
  static async createPrice({
    unit_amount,
    currency,
    product,
    recurring_interval,
    metadata,
  }: {
    unit_amount: number; // in minor units (pence)
    currency: string; // e.g. GBP
    product: string; // product id
    recurring_interval: 'day' | 'week' | 'month' | 'year';
    metadata?: stripe.MetadataParam;
  }): Promise<stripe.Price> {
    const price = await Stripe.prices.create({
      unit_amount,
      currency: currency.toLowerCase(),
      recurring: { interval: recurring_interval },
      product,
      metadata,
    });
    return price;
  }

  // Create a Subscription for a customer and a price
  static async createSubscription({
    customer,
    price,
    metadata,
  }: {
    customer: string; // stripe customer id
    price: string; // stripe price id
    metadata?: stripe.MetadataParam;
  }): Promise<stripe.Subscription> {
    const subscription = await Stripe.subscriptions.create({
      customer,
      items: [{ price }],
      expand: ['latest_invoice.payment_intent'],
      metadata,
    });
    return subscription;
  }

  // Cancel a Subscription
  static async cancelSubscription(
    subscription_id: string,
  ): Promise<stripe.Subscription> {
    const cancelled = await Stripe.subscriptions.cancel(subscription_id);
    return cancelled;
  }

  // Cancel subscription at period end
  static async cancelSubscriptionAtPeriodEnd(
    subscription_id: string,
  ): Promise<stripe.Subscription> {
    const cancelled = await Stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: true,
    });
    return cancelled;
  }

  // Update an existing subscription to use a new price
  static async updateSubscriptionPrice(
    subscription_id: string,
    new_price_id: string,
  ): Promise<stripe.Subscription> {
    // Retrieve current subscription to get item ids
    const current = await Stripe.subscriptions.retrieve(subscription_id, {
      expand: ['items.data.price'],
    });

    const primaryItem = (current as any).items?.data?.[0];
    if (!primaryItem?.id) {
      throw new Error('Subscription has no items to update');
    }

    return await Stripe.subscriptions.update(subscription_id, {
      items: [
        {
          id: primaryItem.id,
          price: new_price_id,
        },
      ],
      expand: ['latest_invoice.payment_intent'],
      proration_behavior: 'create_prorations',
    });
  }

  static handleWebhook(rawBody: string, sig: string | string[]): stripe.Event {
    try {
      const event = Stripe.webhooks.constructEvent(
        rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET,
      );
      return event;
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      throw new Error('Invalid webhook signature');
    }
  }
}
