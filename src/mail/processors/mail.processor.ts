import { MailerService } from '@nestjs-modules/mailer';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('mail-queue')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  constructor(private mailerService: MailerService) {
    super();
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    console.log(
      `Processing job ${job.id} of type ${job.name} with data ${job.data}...`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: any) {
    this.logger.log(`Job ${job.id} with name ${job.name} completed`);
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing job ${job.id} with name ${job.name}`);
    try {
      switch (job.name) {
        case 'sendMemberInvitation':
          this.logger.log('Sending member invitation email');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendOtpCodeToEmail':
          this.logger.log('Sending OTP code to email');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendVerificationLink':
          this.logger.log('Sending verification link');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendSubscriptionPriceNoticeEmail':
          this.logger.log('Sending subscription price notice');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendSubscriptionMigrationConfirmationEmail':
          this.logger.log('Sending subscription migration confirmation');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendUserBannedNotification':
          this.logger.log('Sending user ban notification');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendUserUnbannedNotification':
          this.logger.log('Sending user unban notification');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendAdminBannedNotification':
          this.logger.log('Sending admin ban notification');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendAdminUnbannedNotification':
          this.logger.log('Sending admin unban notification');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        default:
          this.logger.log('Unknown job name');
          return;
      }
    } catch (error) {
      this.logger.error(
        `Error processing job ${job.id} with name ${job.name}`,
        error,
      );
      throw error;
    }
  }
}
