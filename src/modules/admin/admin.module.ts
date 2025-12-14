import { Module } from '@nestjs/common';
import { FaqModule } from './faq/faq.module';
import { ContactModule } from './contact/contact.module';
import { WebsiteInfoModule } from './website-info/website-info.module';
import { PaymentTransactionModule } from './payment-transaction/payment-transaction.module';
import { UserModule } from './user/user.module';
import { NotificationModule } from './notification/notification.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GarageModule } from './garage/garage.module';
import { DriverModule } from './driver/driver.module';
import { BookingModule } from './booking/booking.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { RoleModule } from './role/role.module';
import { VehicleModule } from './vehicle/vehicle.module';

@Module({
  imports: [
    FaqModule,
    ContactModule,
    WebsiteInfoModule,
    PaymentTransactionModule,
    UserModule,
    NotificationModule,
    DashboardModule,
    GarageModule,
    DriverModule,
    BookingModule,
    SubscriptionModule,
    RoleModule,
    VehicleModule,
  ],
})
export class AdminModule {}
