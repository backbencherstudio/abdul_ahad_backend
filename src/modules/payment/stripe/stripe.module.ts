import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { AdminNotificationModule } from '../../admin/notification/admin-notification.module';

@Module({
  imports: [AdminNotificationModule],
  controllers: [StripeController],
  providers: [StripeService],
})
export class StripeModule {}
