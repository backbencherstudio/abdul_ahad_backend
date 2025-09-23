import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PriceMigrationService } from './price-migration.service';

@Injectable()
export class PriceMigrationCron {
  private readonly logger = new Logger(PriceMigrationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  // Run daily at 02:00 server time
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBulkMigrate() {
    try {
      // Find plans that have grandfathered subs with notices sent and due
      const duePlanIds = await this.prisma.garageSubscription.findMany({
        where: {
          is_grandfathered: true,
          notice_sent_at: { not: null },
          migration_scheduled_at: { lte: new Date() },
          status: 'ACTIVE',
        },
        select: { plan_id: true },
        distinct: ['plan_id'],
        take: 20,
      });

      for (const { plan_id } of duePlanIds) {
        const res = await this.priceMigrationService.bulkMigrateReady(
          plan_id,
          50,
        );
        this.logger.log(
          `Bulk migrated plan ${plan_id}: migrated=${res.migrated}, failed=${res.failed}`,
        );
      }
    } catch (e) {
      this.logger.error('Daily bulk migrate failed', e as any);
    }
  }
}
