import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { SubscriptionPlanService } from './subscription-plan.service';
import { GarageSubscriptionController } from './garage-subscription.controller';
import { GarageSubscriptionService } from './garage-subscription.service';
import { SubscriptionStatusService } from './subscription-status.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';
import { PriceMigrationService } from './migration/price-migration.service';
import { PriceMigrationCron } from './migration/price-migration.cron';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionPlanController, GarageSubscriptionController],
  providers: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
    PriceMigrationService,
    PriceMigrationCron,
  ],
  exports: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
    PriceMigrationService,
    PriceMigrationCron,
  ],
})
export class SubscriptionModule {}
