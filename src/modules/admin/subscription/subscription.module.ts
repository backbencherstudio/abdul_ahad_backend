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
import { MigrationJobService } from './migration/migration-job.service';
import { JobAttemptService } from './migration/job-attempt.service';
import { MigrationErrorHandlerService } from './migration/migration-error-handler.service';
import { MigrationRetryService } from './migration/migration-retry.service';
import { MigrationJobController } from './migration/migration-job.controller';
import { JobAttemptController } from './migration/job-attempt.controller';
import { MigrationMonitoringController } from './migration/migration-monitoring.controller';
import { MigrationRecoveryController } from './migration/migration-recovery.controller';
import { MigrationErrorRecoveryController } from './migration/migration-error-recovery.controller';
import { SubscriptionVisibilityModule } from '../../../common/lib/subscription/subscription-visibility.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, SubscriptionVisibilityModule, NotificationModule],
  controllers: [
    SubscriptionPlanController,
    GarageSubscriptionController,
    MigrationJobController,
    JobAttemptController,
    MigrationMonitoringController,
    MigrationRecoveryController,
    MigrationErrorRecoveryController,
  ],
  providers: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
    PriceMigrationService,
    PriceMigrationCron,
    MigrationJobService,
    JobAttemptService,
    MigrationErrorHandlerService,
    MigrationRetryService,
  ],
  exports: [
    SubscriptionPlanService,
    GarageSubscriptionService,
    SubscriptionStatusService,
    SubscriptionAnalyticsService,
    PriceMigrationService,
    PriceMigrationCron,
    MigrationJobService,
    JobAttemptService,
    MigrationErrorHandlerService,
    MigrationRetryService,
  ],
})
export class SubscriptionModule {}
