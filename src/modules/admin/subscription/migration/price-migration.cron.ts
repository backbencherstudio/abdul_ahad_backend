import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PriceMigrationService } from './price-migration.service';
import { NotificationService } from '../../notification/notification.service';

@Injectable()
export class PriceMigrationCron {
  private readonly logger = new Logger(PriceMigrationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceMigrationService: PriceMigrationService,
    private readonly notificationService: NotificationService,
  ) {}

  // Run daily at 02:00 server time
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBulkMigrate(options?: { bypassDateCheck?: boolean }) {
    const bypassDateCheck = options?.bypassDateCheck || false;

    try {
      this.logger.log(
        `🔄 Migration check started - Bypass date check: ${bypassDateCheck}`,
      );

      // Build where condition dynamically
      const baseCondition = {
        is_grandfathered: true,
        notice_sent_at: { not: null },
        status: 'ACTIVE' as const,
      };

      const whereCondition = bypassDateCheck
        ? baseCondition // No date restriction for testing
        : { ...baseCondition, migration_scheduled_at: { lte: new Date() } }; // Normal behavior

      // Find plans that have grandfathered subs with notices sent and due
      const duePlanIds = await this.prisma.garageSubscription.findMany({
        where: whereCondition,
        select: { plan_id: true },
        distinct: ['plan_id'],
        take: 20,
      });

      this.logger.log(
        `📋 Found ${duePlanIds.length} plans for migration (bypass: ${bypassDateCheck})`,
      );
      console.log('Due plans:', duePlanIds);

      const migrationResults = [];

      for (const { plan_id } of duePlanIds) {
        this.logger.log(`🚀 Processing plan: ${plan_id}`);
        const res = await this.priceMigrationService.bulkMigrateReady(
          plan_id,
          50,
          bypassDateCheck, // Pass the bypass parameter
        );
        migrationResults.push(res);
        this.logger.log(
          `✅ Bulk migrated plan ${plan_id}: migrated=${res.migrated}, failed=${res.failed}`,
        );
      }

      // After cron completes successfully
      if (duePlanIds.length > 0) {
        const totalMigrated = migrationResults.reduce(
          (sum, r) => sum + r.migrated,
          0,
        );
        const totalFailed = migrationResults.reduce(
          (sum, r) => sum + r.failed,
          0,
        );

        try {
          await this.notificationService.sendToAllAdmins({
            type: 'migration',
            title: 'Daily Migration Summary',
            message: `Daily migration completed. Processed ${duePlanIds.length} plans. Migrated: ${totalMigrated}, Failed: ${totalFailed}`,
            metadata: {
              plans_processed: duePlanIds.length,
              total_migrated: totalMigrated,
              total_failed: totalFailed,
            },
          });
        } catch (notificationError) {
          this.logger.error(
            'Failed to send daily migration summary notification:',
            notificationError,
          );
        }
      }

      this.logger.log(
        `🏁 Migration check completed - Processed ${duePlanIds.length} plans`,
      );
    } catch (e) {
      this.logger.error('❌ Daily bulk migrate failed:', e as any);

      try {
        await this.notificationService.notifyCronJobFailed({
          jobName: 'Daily Bulk Price Migration',
          errorMessage: (e as Error).message || 'Unknown error',
        });
      } catch (notificationError) {
        this.logger.error(
          'Failed to send cron job failure notification:',
          notificationError,
        );
      }
    }
  }
}
