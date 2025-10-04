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
}
