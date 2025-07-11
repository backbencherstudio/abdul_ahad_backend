import { Module } from '@nestjs/common';
import { NotificationModule } from './notification/notification.module';
import { ContactModule } from './contact/contact.module';
import { FaqModule } from './faq/faq.module';
import { VehicleModule } from './vehicle/vehicle.module';

@Module({
  imports: [NotificationModule, ContactModule, FaqModule, VehicleModule],
})
export class ApplicationModule {}
