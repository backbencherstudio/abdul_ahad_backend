import { Module } from '@nestjs/common';
import { GarageDashboardController } from './garage-dashboard.controller';
import { GarageProfileService } from './services/garage-profile.service';
import { GaragePricingService } from './services/garage-pricing.service';
import { GarageScheduleService } from './services/garage-schedule.service';

import { PrismaModule } from '../../../prisma/prisma.module';
import { GarageBookingService } from './services/garage-booking.service';
import { GaragePaymentService } from './services/garage-payment.service';
import { GarageInvoiceService } from './services/garage-invoice.service';

@Module({
  imports: [PrismaModule],
  controllers: [GarageDashboardController],
  providers: [
    GarageProfileService,
    GaragePricingService,
    GarageScheduleService,
    GarageBookingService,
    GaragePaymentService,
    GarageInvoiceService,
  ],
  exports: [
    GarageProfileService,
    GaragePricingService,
    GarageScheduleService,
    GarageBookingService,
    GaragePaymentService,
    GarageInvoiceService,
  ],
})
export class GarageDashboardModule {}
