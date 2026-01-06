import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { VehicleService } from './vehicle.service';
import { VehicleController } from './vehicle.controller';
import { VehicleGarageService } from './vehicle-garage.service';
import { VehicleBookingService } from './vehicle-booking.service';
import { GarageDashboardModule } from '../garage-dashboard/garage-dashboard.module';
import { MotReminderProcessor } from './mot-reminder.processor';
import { NotificationModule } from '../notification/notification.module';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [
    PrismaModule,
    GarageDashboardModule,
    NotificationModule,
    MailModule,
  ],
  providers: [
    VehicleService,
    VehicleGarageService,
    VehicleBookingService,
    MotReminderProcessor,
  ],
  controllers: [VehicleController],
  exports: [VehicleService, VehicleGarageService, VehicleBookingService],
})
export class VehicleModule {}
