import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SubscriptionVisibilityService } from './subscription-visibility.service';

@Module({
  imports: [PrismaModule],
  providers: [SubscriptionVisibilityService],
  exports: [SubscriptionVisibilityService],
})
export class SubscriptionVisibilityModule {}
