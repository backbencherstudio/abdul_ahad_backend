import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { SubscriptionPlanService } from './subscription-plan.service';
import { GarageSubscriptionController } from './garage-subscription.controller';
import { GarageSubscriptionService } from './garage-subscription.service';
import { SubscriptionStatusService } from './subscription-status.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';


@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionPlanController, GarageSubscriptionController],
  providers: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
  ],
  exports: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
  ],
})
export class SubscriptionModule {}
