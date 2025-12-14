import { Module } from '@nestjs/common';
import { NotificationModule } from './notification/notification.module';
import { ContactModule } from './contact/contact.module';
import { FaqModule } from './faq/faq.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { GarageDashboardModule } from './garage-dashboard/garage-dashboard.module';

@Module({
  imports: [
    NotificationModule,
    ContactModule,
    FaqModule,
    VehicleModule,
    GarageDashboardModule,
  ],
})
export class ApplicationModule {}
