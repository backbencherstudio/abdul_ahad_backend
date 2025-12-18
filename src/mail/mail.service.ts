import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { MailerService } from '@nestjs-modules/mailer';
import appConfig from '../config/app.config';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue('mail-queue') private queue: Queue,
    private mailerService: MailerService,
  ) {}

  async sendMemberInvitation({ user, member, url }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `${user.fname} is inviting you to ${appConfig().app.name}`;

      // add to queue
      await this.queue.add('sendMemberInvitation', {
        to: member.email,
        from: from,
        subject: subject,
        template: 'member-invitation',
        context: {
          user: user,
          member: member,
          url: url,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  // send otp code for email verification
  async sendOtpCodeToEmail({ name, email, otp }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Email Verification';

      // add to queue
      await this.queue.add('sendOtpCodeToEmail', {
        to: email,
        from: from,
        subject: subject,
        template: 'email-verification',
        context: {
          name: name,
          otp: otp,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async sendVerificationLink(params: {
    email: string;
    name: string;
    token: string;
    type: string;
  }) {
    try {
      const verificationLink = `${appConfig().app.client_app_url}/verify-email?token=${params.token}&email=${params.email}&type=${params.type}`;

      // add to queue
      await this.queue.add('sendVerificationLink', {
        to: params.email,
        subject: 'Verify Your Email',
        template: './verification-link',
        context: {
          name: params.name,
          verificationLink,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  // Enqueue subscription price notice email (30-day notice)
  async sendSubscriptionPriceNoticeEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    old_price: string; // formatted e.g. £30.00
    new_price: string; // formatted e.g. £49.00
    effective_date: string; // formatted date
    billing_portal_url: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Upcoming subscription price update';

      await this.queue.add('sendSubscriptionPriceNoticeEmail', {
        to: params.to,
        from,
        subject,
        template: 'subscription-price-notice',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          old_price: params.old_price,
          new_price: params.new_price,
          effective_date: params.effective_date,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  // Enqueue subscription migration confirmation email
  async sendSubscriptionMigrationConfirmationEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    new_price: string; // formatted e.g. £49.00
    effective_date: string;
    next_billing_date: string;
    billing_portal_url: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Your subscription has been updated';

      await this.queue.add('sendSubscriptionMigrationConfirmationEmail', {
        to: params.to,
        from,
        subject,
        template: 'subscription-migration-confirmation',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          new_price: params.new_price,
          effective_date: params.effective_date,
          next_billing_date: params.next_billing_date,
          billing_portal_url: params.billing_portal_url,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  /**
   * Send user ban notification email
   * @param user - User object with email and name
   * @param reason - Reason for ban (optional)
   */
  async sendUserBannedNotification({ user, reason }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Account Banned - Simply MOT';

      // add to queue
      await this.queue.add('sendUserBannedNotification', {
        to: user.email,
        from: from,
        subject: subject,
        template: 'user-banned',
        context: {
          user: {
            name: user.name,
            email: user.email,
          },
          reason: reason || 'No reason provided',
        },
      });

      console.log(`Ban notification email queued for user: ${user.email}`);
    } catch (error) {
      console.error('Error queuing ban notification email:', error);
    }
  }

  /**
   * Send user unban notification email
   * @param user - User object with email and name
   * @param hadSubscription - Whether user had active subscription before ban
   */
  async sendUserUnbannedNotification({ user, hadSubscription = false }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Account Restored - Simply MOT';

      // add to queue
      await this.queue.add('sendUserUnbannedNotification', {
        to: user.email,
        from: from,
        subject: subject,
        template: 'user-unbanned',
        context: {
          user: {
            name: user.name,
            email: user.email,
          },
          hadSubscription: hadSubscription,
        },
      });

      console.log(`Unban notification email queued for user: ${user.email}`);
    } catch (error) {
      console.error('Error queuing unban notification email:', error);
    }
  }

  /**
   * Send admin ban notification email
   * @param user - User object with email and name
   * @param reason - Reason for ban (optional)
   */
  async sendAdminBannedNotification({ user, reason }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Administrative Access Revoked - Simply MOT';

      // add to queue
      await this.queue.add('sendAdminBannedNotification', {
        to: user.email,
        from: from,
        subject: subject,
        template: 'admin-banned',
        context: {
          user: {
            name: user.name,
            email: user.email,
          },
          reason: reason || 'Administrative action',
        },
      });

      console.log(
        `Admin ban notification email queued for user: ${user.email}`,
      );
    } catch (error) {
      console.error('Error queuing admin ban notification email:', error);
    }
  }

  /**
   * Send admin unban notification email
   * @param user - User object with email and name
   */
  async sendAdminUnbannedNotification({ user }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Administrative Access Restored - Simply MOT';

      // add to queue
      await this.queue.add('sendAdminUnbannedNotification', {
        to: user.email,
        from: from,
        subject: subject,
        template: 'admin-unbanned',
        context: {
          user: {
            name: user.name,
            email: user.email,
          },
        },
      });

      console.log(
        `Admin unban notification email queued for user: ${user.email}`,
      );
    } catch (error) {
      console.error('Error queuing admin unban notification email:', error);
    }
  }

  /**
   * Send trial warning email to garage owner
   * This email is sent when a trial subscription is about to end
   *
   * @param params - Email parameters
   */
  async sendTrialWarningEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    price_formatted: string;
    trial_end_date: string;
    days_remaining: number;
    billing_portal_url?: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Trial Ending Soon - ${params.days_remaining} day${params.days_remaining !== 1 ? 's' : ''} remaining`;

      await this.queue.add('sendTrialWarningEmail', {
        to: params.to,
        from,
        subject,
        template: 'trial-warning',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          price_formatted: params.price_formatted,
          trial_end_date: params.trial_end_date,
          days_remaining: params.days_remaining,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(`Trial warning email queued for garage: ${params.to}`);
    } catch (error) {
      console.error('Error queuing trial warning email:', error);
    }
  }

  /**
   * Send trial-to-paid confirmation email
   * This email is sent when a trial subscription converts to paid
   *
   * @param params - Email parameters
   */
  async sendTrialToPaidConfirmationEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    price_formatted: string;
    next_billing_date: string;
    billing_portal_url?: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Welcome to ${params.plan_name} - Your trial has converted to paid!`;

      await this.queue.add('sendTrialToPaidConfirmationEmail', {
        to: params.to,
        from,
        subject,
        template: 'trial-to-paid-confirmation',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          price_formatted: params.price_formatted,
          next_billing_date: params.next_billing_date,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(
        `Trial-to-paid confirmation email queued for garage: ${params.to}`,
      );
    } catch (error) {
      console.error('Error queuing trial-to-paid confirmation email:', error);
    }
  }

  /**
   * Send trial expiration email
   * This email is sent when a trial subscription expires without payment
   *
   * @param params - Email parameters
   */
  async sendTrialExpirationEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    price_formatted: string;
    billing_portal_url?: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Your trial has ended - Resubscribe to continue`;

      await this.queue.add('sendTrialExpirationEmail', {
        to: params.to,
        from,
        subject,
        template: 'trial-expiration',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          price_formatted: params.price_formatted,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(`Trial expiration email queued for garage: ${params.to}`);
    } catch (error) {
      console.error('Error queuing trial expiration email:', error);
    }
  }

  /**
   * Send payment failure notification email
   * This email is sent when a subscription payment fails
   *
   * @param params - Email parameters
   */
  async sendPaymentFailureNotification(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    price_formatted: string;
    failure_reason: string;
    amount_due: string;
    currency: string;
    billing_portal_url?: string;
    isFirstFailure?: boolean;
    isGracePeriodExpired?: boolean;
    gracePeriodEnd?: Date;
    retryInfo?: any;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Payment Failed - Action Required`;

      await this.queue.add('sendPaymentFailureNotification', {
        to: params.to,
        from,
        subject,
        template: 'payment-failure',
        context: {
          garage_name: params.garage_name,
          plan_name: params.plan_name,
          price_formatted: params.price_formatted,
          failure_reason: params.failure_reason,
          amount_due: params.amount_due,
          currency: params.currency.toUpperCase(),
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
          isFirstFailure: params.isFirstFailure,
          isGracePeriodExpired: params.isGracePeriodExpired,
          gracePeriodEnd: params.gracePeriodEnd
            ? params.gracePeriodEnd.toLocaleDateString()
            : null,
          gracePeriodDaysRemaining: params.gracePeriodEnd
            ? Math.ceil(
                (params.gracePeriodEnd.getTime() - new Date().getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0,
          retryInfo: params.retryInfo,
          retryAttempt: params.retryInfo?.attempt || 1,
          maxRetryAttempts: params.retryInfo?.max_attempts || 3,
          nextRetryDate:
            params.retryInfo?.next_retry_date?.toLocaleDateString() || null,
          isMaxRetriesReached:
            params.retryInfo?.status === 'max_retries_reached',
        },
      });

      console.log(
        `Payment failure notification email queued for garage: ${params.to}`,
      );
    } catch (error) {
      console.error('Error queuing payment failure notification:', error);
    }
  }

  /**
   * Send subscription welcome email
   * This email is sent when a user's subscription becomes active
   *
   * @param params - Email parameters
   */
  async sendSubscriptionWelcomeEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    price_formatted: string;
    currency: string;
    next_billing_date?: string;
    billing_portal_url?: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Welcome to Your Subscription - ${process.env.APP_NAME}`;

      await this.queue.add('sendSubscriptionWelcomeEmail', {
        to: params.to,
        from,
        subject,
        template: 'subscription-welcome',
        context: {
          garage_name: params.garage_name,
          garage_email: params.to,
          plan_name: params.plan_name,
          price_formatted: params.price_formatted,
          currency: params.currency.toUpperCase(),
          next_billing_date: params.next_billing_date,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(`Subscription welcome email queued for garage: ${params.to}`);
    } catch (error) {
      console.error('Error sending subscription welcome email:', error);
    }
  }

  /**
   * Send payment success email
   * This email is sent when a payment is processed successfully
   *
   * @param params - Email parameters
   */
  async sendPaymentSuccessEmail(params: {
    to: string;
    garage_name: string;
    plan_name: string;
    amount_paid: string;
    currency: string;
    payment_date: string;
    billing_period: string;
    payment_method: string;
    transaction_id: string;
    next_billing_date?: string;
    next_billing_amount?: string;
    billing_portal_url?: string;
  }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `Payment Successful - ${process.env.APP_NAME}`;

      await this.queue.add('sendPaymentSuccessEmail', {
        to: params.to,
        from,
        subject,
        template: 'payment-success',
        context: {
          garage_name: params.garage_name,
          garage_email: params.to,
          plan_name: params.plan_name,
          amount_paid: params.amount_paid,
          currency: params.currency.toUpperCase(),
          payment_date: params.payment_date,
          billing_period: params.billing_period,
          payment_method: params.payment_method,
          transaction_id: params.transaction_id,
          next_billing_date: params.next_billing_date,
          next_billing_amount: params.next_billing_amount,
          billing_portal_url: params.billing_portal_url,
          support_email: appConfig().mail.from,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(`Payment success email queued for garage: ${params.to}`);
    } catch (error) {
      console.error('Error sending payment success email:', error);
    }
  }

  /**
   * Generic method to send user notifications (Driver/Garage approval, rejection, deletion)
   * @param params - Notification parameters
   */
  async sendUserNotification(params: {
    to: string;
    userType: 'driver' | 'garage';
    actionType: 'approved' | 'rejected' | 'deleted';
    userName: string;
    reason?: string;
  }) {
    try {
      const { to, userType, actionType, userName, reason } = params;

      // Configuration for different notification types
      const config = {
        driver: {
          approved: {
            subject: 'Account Approved - Simply MOT',
            template: 'driver-approved',
            logMessage: 'Driver approval',
          },
          rejected: {
            subject: 'Account Status Update - Simply MOT',
            template: 'driver-rejected',
            logMessage: 'Driver rejection',
          },
          deleted: {
            subject: 'Account Deleted - Simply MOT',
            template: 'driver-deleted',
            logMessage: 'Driver deletion',
          },
        },
        garage: {
          approved: {
            subject: 'Garage Account Approved - Simply MOT',
            template: 'garage-approved',
            logMessage: 'Garage approval',
          },
          rejected: {
            subject: 'Garage Account Status Update - Simply MOT',
            template: 'garage-rejected',
            logMessage: 'Garage rejection',
          },
        },
      };

      const notificationConfig = config[userType][actionType];
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;

      // Build context based on user type
      const context: any = {
        app_name: process.env.APP_NAME || appConfig().app.name,
        support_email: appConfig().mail.from,
      };

      if (userType === 'driver') {
        context.driver_name = userName;
      } else {
        context.garage_name = userName;
      }

      if (reason) {
        context.reason = reason;
      } else if (actionType === 'rejected') {
        context.reason = 'Administrative decision';
      } else if (actionType === 'deleted') {
        context.reason = 'Administrative action';
      }

      // Queue the email
      await this.queue.add(
        `send${userType.charAt(0).toUpperCase() + userType.slice(1)}${actionType.charAt(0).toUpperCase() + actionType.slice(1)}Notification`,
        {
          to,
          from,
          subject: notificationConfig.subject,
          template: notificationConfig.template,
          context,
        },
      );

      console.log(`${notificationConfig.logMessage} email queued for: ${to}`);
    } catch (error) {
      console.error('Error queuing user notification email:', error);
    }
  }

  /**
   * Send MOT expiry reminder email
   */
  async sendMotExpiryReminder(user: any, vehicle: any, daysRemaining: number) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `MOT Expiry Reminder - ${vehicle.registration_number}`;

      await this.queue.add('sendMotExpiryReminder', {
        to: user.email,
        from,
        subject,
        template: 'mot-expiry-reminder',
        context: {
          user_name: user.name,
          vehicle_registration: vehicle.registration_number,
          vehicle_make: vehicle.make,
          vehicle_model: vehicle.model,
          mot_expiry_date: vehicle.mot_expiry_date.toLocaleDateString(),
          days_remaining: daysRemaining,
          app_name: process.env.APP_NAME || appConfig().app.name,
        },
      });

      console.log(
        `MOT expiry reminder email queued for ${user.email} for vehicle ${vehicle.registration_number}`,
      );
    } catch (error) {
      console.error('Error queuing MOT expiry reminder email:', error);
    }
  }
}
