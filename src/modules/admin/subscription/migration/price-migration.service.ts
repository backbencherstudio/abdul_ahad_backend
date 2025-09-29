import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StripePayment } from '../../../../common/lib/Payment/stripe/StripePayment';
import { MailService } from '../../../../mail/mail.service';

@Injectable()
export class PriceMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // Create a new Stripe Price for the plan product and link it
  async createNewPriceVersion(planId: string, newPricePence: number) {
    if (!newPricePence || newPricePence <= 0) {
      throw new BadRequestException('newPricePence must be > 0');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    // Ensure Stripe product exists
    let productId = (plan as any).stripe_product_id as string | null;
    if (!productId) {
      const product = await StripePayment.createProduct({
        name: plan.name,
        active: plan.is_active,
      });
      productId = product.id;
      await this.prisma.subscriptionPlan.update({
        where: { id: planId },
        data: { stripe_product_id: productId },
      });
    }

    // Create a new immutable Stripe Price
    const price = await StripePayment.createPrice({
      unit_amount: newPricePence,
      currency: plan.currency || 'GBP',
      product: productId!,
      recurring_interval: 'month',
      metadata: { plan_id: plan.id },
    });

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        price_pence: newPricePence,
        stripe_price_id: price.id,
        is_legacy_price: true,
        updated_at: new Date(),
      },
    });

    // ✅ FIXED: Mark existing active subscriptions as grandfathered
    const grandfatheredCount = await this.prisma.garageSubscription.updateMany({
      where: {
        plan_id: planId,
        status: 'ACTIVE',
        is_grandfathered: false, // Only update non-grandfathered subscriptions
      },
      data: {
        is_grandfathered: true,
        original_price_pence: plan.price_pence, // Store the old price
        // Keep their current price_pence unchanged (they pay old price)
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      plan_id: updated.id,
      old_price_pence: plan.price_pence,
      new_price_pence: updated.price_pence,
      stripe_price_id: price.id,
      is_legacy_price: updated.is_legacy_price,
      grandfathered_subscriptions: grandfatheredCount.count,
      message: `New price version created successfully. ${grandfatheredCount.count} existing subscribers marked as grandfathered.`,
    };
  }

  // Mark grandfathered subs and schedule migration window (no email here; that’s Chapter 5)
  async sendMigrationNotices(planId: string, noticePeriodDays = 30) {
    if (noticePeriodDays < 1) {
      throw new BadRequestException('noticePeriodDays must be >= 1');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const now = new Date();
    const scheduledAt = new Date(
      now.getTime() + noticePeriodDays * 24 * 60 * 60 * 1000,
    );

    const { count } = await this.prisma.garageSubscription.updateMany({
      where: {
        plan_id: planId,
        status: 'ACTIVE',
        is_grandfathered: true,
        notice_sent_at: null,
      },
      data: {
        notice_sent_at: now,
        migration_scheduled_at: scheduledAt,
        updated_at: now,
      },
    });

    // Enqueue notice emails for affected subscriptions (just marked)
    const affected = await this.prisma.garageSubscription.findMany({
      where: {
        plan_id: planId,
        status: 'ACTIVE',
        is_grandfathered: true,
        notice_sent_at: now,
      },
      include: {
        garage: { select: { email: true, garage_name: true } },
      },
      take: 200,
    });

    const formatGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
    for (const sub of affected) {
      const to = sub.garage?.email;
      if (!to) continue;
      await this.mailService.sendSubscriptionPriceNoticeEmail({
        to,
        garage_name: sub.garage?.garage_name || 'Customer',
        plan_name: plan.name,
        old_price: formatGBP(sub.original_price_pence ?? sub.price_pence),
        new_price: formatGBP(plan.price_pence),
        effective_date: scheduledAt.toDateString(),
        billing_portal_url: `${process.env.APP_URL || 'https://app.local'}/billing`,
      });
    }

    return {
      success: true,
      affected: count,
      scheduled_for: scheduledAt,
      message: `Migration notices sent to ${count} grandfathered subscribers. They will be ready for migration on ${scheduledAt.toISOString()}.`,
    };
  }

  // Manual migrate a single subscription – switches Stripe price then updates DB
  async migrateCustomer(subscriptionId: string) {
    const sub = await this.prisma.garageSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    if (sub.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only ACTIVE subscriptions can be migrated',
      );
    }
    if (!sub.is_grandfathered) {
      return {
        success: true,
        message: 'Already migrated',
        subscription_id: sub.id,
      };
    }
    if (
      !sub.migration_scheduled_at ||
      sub.migration_scheduled_at > new Date()
    ) {
      throw new BadRequestException(
        'Migration is not yet due (notice period not completed)',
      );
    }

    if (!sub.plan?.stripe_price_id) {
      throw new BadRequestException(
        'Plan is not synced to Stripe (missing stripe_price_id)',
      );
    }
    if (!sub.stripe_subscription_id) {
      throw new BadRequestException(
        'No Stripe subscription linked for this customer',
      );
    }

    // Switch the subscription to the new Stripe price
    await StripePayment.updateSubscriptionPrice(
      sub.stripe_subscription_id,
      sub.plan.stripe_price_id,
    );

    const updated = await this.prisma.garageSubscription.update({
      where: { id: sub.id },
      data: {
        original_price_pence: sub.original_price_pence ?? sub.price_pence,
        price_pence: sub.plan.price_pence, // sync to plan’s current price
        is_grandfathered: false,
        updated_at: new Date(),
      },
    });

    // Enqueue confirmation email (best-effort)
    try {
      const g = await this.prisma.user.findUnique({
        where: { id: sub.garage_id },
        select: { email: true, garage_name: true },
      });
      const to = g?.email;
      if (to) {
        const formatGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
        await this.mailService.sendSubscriptionMigrationConfirmationEmail({
          to,
          garage_name: g?.garage_name || 'Customer',
          plan_name: sub.plan.name,
          new_price: formatGBP(updated.price_pence),
          effective_date: new Date().toDateString(),
          next_billing_date: updated.next_billing_date
            ? new Date(updated.next_billing_date).toDateString()
            : 'your usual cycle',
          billing_portal_url: `${process.env.APP_URL || 'https://app.local'}/billing`,
        });
      }
    } catch {}

    return {
      success: true,
      subscription_id: updated.id,
      new_price_pence: updated.price_pence,
    };
  }

  // Minimal status snapshot for a plan
  async getMigrationStatus(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const [total, grandfathered, noticeSent, readyToMigrate, migrated] =
      await Promise.all([
        this.prisma.garageSubscription.count({ where: { plan_id: planId } }),
        this.prisma.garageSubscription.count({
          where: { plan_id: planId, is_grandfathered: true },
        }),
        this.prisma.garageSubscription.count({
          where: {
            plan_id: planId,
            is_grandfathered: true,
            notice_sent_at: { not: null },
          },
        }),
        this.prisma.garageSubscription.count({
          where: {
            plan_id: planId,
            is_grandfathered: true,
            notice_sent_at: { not: null },
            migration_scheduled_at: { lte: new Date() },
            status: 'ACTIVE',
          },
        }),
        this.prisma.garageSubscription.count({
          where: { plan_id: planId, is_grandfathered: false },
        }),
      ]);

    return {
      success: true,
      plan_id: planId,
      plan_name: plan.name,
      plan_price_pence: plan.price_pence,
      is_legacy_price: plan.is_legacy_price,
      totals: {
        total,
        grandfathered,
        notice_sent: noticeSent,
        ready_to_migrate: readyToMigrate,
        migrated,
      },
    };
  }

  // Bulk migrate a batch of subscriptions that are ready
  async bulkMigrateReady(planId: string, batchSize: number = 50) {
    const now = new Date();
    const ready = await this.prisma.garageSubscription.findMany({
      where: {
        plan_id: planId,
        is_grandfathered: true,
        notice_sent_at: { not: null },
        migration_scheduled_at: { lte: now },
        status: 'ACTIVE',
      },
      orderBy: { created_at: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    const migrated_ids: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const s of ready) {
      try {
        const res = await this.migrateCustomer(s.id);
        if (res?.success) migrated_ids.push(s.id);
        else failed.push({ id: s.id, reason: 'unknown' });
      } catch (e) {
        failed.push({ id: s.id, reason: (e as Error)?.message || 'error' });
      }
    }

    return {
      success: true,
      attempted: ready.length,
      migrated: migrated_ids.length,
      failed: failed.length,
      migrated_ids,
      failed_items: failed,
    };
  }
}
