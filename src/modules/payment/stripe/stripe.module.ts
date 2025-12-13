import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { NotificationModule } from '../../admin/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [StripeController],
  providers: [StripeService],
})
export class StripeModule {}
