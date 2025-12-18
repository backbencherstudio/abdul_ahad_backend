import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailService } from 'src/mail/mail.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

@Injectable()
export class MotReminderProcessor {
  private readonly logger = new Logger(MotReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.debug('Checking for MOT expiry reminders...');

    const today = new Date();

    // ✅ Only 15 & 7 days reminder
    const reminderPeriods = [15, 7];

    for (const days of reminderPeriods) {
      const expiryDate = new Date(today);
      expiryDate.setDate(today.getDate() + days);

      const startOfDay = new Date(expiryDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(expiryDate);
      endOfDay.setHours(23, 59, 59, 999);

      const vehicles = await this.prisma.vehicle.findMany({
        where: {
          mot_expiry_date: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
        include: {
          user: true,
        },
      });

      for (const vehicle of vehicles) {
        if (!vehicle.user) continue;

        try {
          const { user } = vehicle;

          const message = `Your vehicle ${vehicle.make} ${vehicle.model} (${vehicle.registration_number}) has an MOT expiring in ${days} days.`;

          // 🔔 In-app notification
          await this.notificationService.create({
            receiver_id: user.id,
            type: NotificationType.MOT_EXPIRY_REMINDER,
            text: message,
            entity_id: vehicle.id,
          });

          // 📧 Email reminder
          await this.mailService.sendMotExpiryReminder(user, vehicle, days);

          this.logger.log(
            `MOT reminder sent (${days} days) → ${user.email} | ${vehicle.registration_number}`,
          );
        } catch (error) {
          // ❌ One failure won't stop others
          this.logger.error(
            `Failed to send MOT reminder (${days} days) for vehicle ${vehicle.registration_number}`,
            error.stack,
          );
        }
      }
    }
  }
}
