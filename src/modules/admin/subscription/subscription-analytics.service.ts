import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SubscriptionAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get basic subscription analytics
   */
  async getSubscriptionAnalytics(): Promise<{
    total_revenue: number;
    monthly_revenue: number;
    active_subscriptions: number;
    total_subscriptions: number;
    average_revenue_per_subscription: number;
  }> {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    // Get all active subscriptions
    const activeSubscriptions = await this.prisma.garageSubscription.findMany({
      where: { status: 'ACTIVE' },
      select: { price_pence: true, created_at: true },
    });

    // Get all subscriptions for total count
    const totalSubscriptions = await this.prisma.garageSubscription.count();

    // Calculate total revenue (all time)
    const totalRevenue = activeSubscriptions.reduce(
      (sum, sub) => sum + sub.price_pence,
      0,
    );

    // Calculate monthly revenue (subscriptions created this month)
    const monthlySubscriptions = activeSubscriptions.filter(
      (sub) => sub.created_at >= currentMonth && sub.created_at < nextMonth,
    );
    const monthlyRevenue = monthlySubscriptions.reduce(
      (sum, sub) => sum + sub.price_pence,
      0,
    );

    // Calculate average revenue per subscription
    const averageRevenue =
      activeSubscriptions.length > 0
        ? totalRevenue / activeSubscriptions.length
        : 0;

    return {
      total_revenue: Math.round(totalRevenue / 100), // Convert pence to pounds
      monthly_revenue: Math.round(monthlyRevenue / 100),
      active_subscriptions: activeSubscriptions.length,
      total_subscriptions: totalSubscriptions,
      average_revenue_per_subscription: Math.round(averageRevenue / 100),
    };
  }

  /**
   * Get subscription status breakdown
   */
  async getSubscriptionStatusBreakdown(): Promise<{
    active: number;
    inactive: number;
    suspended: number;
    cancelled: number;
    past_due: number;
  }> {
    const [active, inactive, suspended, cancelled, pastDue] = await Promise.all(
      [
        this.prisma.garageSubscription.count({ where: { status: 'ACTIVE' } }),
        this.prisma.garageSubscription.count({ where: { status: 'INACTIVE' } }),
        this.prisma.garageSubscription.count({
          where: { status: 'SUSPENDED' },
        }),
        this.prisma.garageSubscription.count({
          where: { status: 'CANCELLED' },
        }),
        this.prisma.garageSubscription.count({ where: { status: 'PAST_DUE' } }),
      ],
    );

    return {
      active,
      inactive,
      suspended,
      cancelled,
      past_due: pastDue,
    };
  }

  /**
   * Get recent subscription activity
   */
  async getRecentSubscriptionActivity(limit: number = 10): Promise<
    {
      id: string;
      garage_name: string;
      plan_name: string;
      status: string;
      created_at: Date;
      price_pence: number;
    }[]
  > {
    const recentSubscriptions = await this.prisma.garageSubscription.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
      include: {
        garage: {
          select: { garage_name: true },
        },
        plan: {
          select: { name: true },
        },
      },
    });

    return recentSubscriptions.map((sub) => ({
      id: sub.id,
      garage_name: sub.garage.garage_name || 'Unknown',
      plan_name: sub.plan.name,
      status: sub.status,
      created_at: sub.created_at,
      price_pence: sub.price_pence,
    }));
  }

  /**
   * Get monthly revenue trend (last 6 months)
   */
  async getMonthlyRevenueTrend(): Promise<
    {
      month: string;
      revenue: number;
      subscriptions: number;
    }[]
  > {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const subscriptions = await this.prisma.garageSubscription.findMany({
      where: {
        created_at: { gte: sixMonthsAgo },
        status: 'ACTIVE',
      },
      select: {
        created_at: true,
        price_pence: true,
      },
    });

    // Group by month
    const monthlyData: { [key: string]: { revenue: number; count: number } } =
      {};

    subscriptions.forEach((sub) => {
      const monthKey = sub.created_at.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { revenue: 0, count: 0 };
      }
      monthlyData[monthKey].revenue += sub.price_pence;
      monthlyData[monthKey].count += 1;
    });

    // Convert to array and format
    return Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        revenue: Math.round(data.revenue / 100), // Convert to pounds
        subscriptions: data.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Global migration summary (minimal) across all plans
   */
  async getGlobalMigrationSummary(): Promise<{
    plans_total: number;
    subs_total: number;
    grandfathered: number;
    notice_sent: number;
    ready_to_migrate: number;
    migrated: number;
    top_plans_by_ready: Array<{
      plan_id: string;
      plan_name: string;
      ready_to_migrate: number;
      total: number;
    }>;
  }> {
    const now = new Date();

    const [
      plans_total,
      subs_total,
      grandfathered,
      notice_sent,
      ready_to_migrate,
      migrated,
    ] = await Promise.all([
      this.prisma.subscriptionPlan.count(),
      this.prisma.garageSubscription.count(),
      this.prisma.garageSubscription.count({
        where: { is_grandfathered: true },
      }),
      this.prisma.garageSubscription.count({
        where: { is_grandfathered: true, notice_sent_at: { not: null } },
      }),
      this.prisma.garageSubscription.count({
        where: {
          is_grandfathered: true,
          notice_sent_at: { not: null },
          migration_scheduled_at: { lte: now },
          status: 'ACTIVE',
        },
      }),
      this.prisma.garageSubscription.count({
        where: { is_grandfathered: false },
      }),
    ]);

    // Top plans by `ready_to_migrate`
    const readyGroup = await this.prisma.garageSubscription.groupBy({
      by: ['plan_id'],
      where: {
        is_grandfathered: true,
        notice_sent_at: { not: null },
        migration_scheduled_at: { lte: now },
        status: 'ACTIVE',
      },
      _count: { plan_id: true },
      orderBy: { _count: { plan_id: 'desc' } },
      take: 5,
    });

    const planIds = readyGroup.map((g) => g.plan_id);
    const plans = planIds.length
      ? await this.prisma.subscriptionPlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true },
        })
      : [];
    const planNameMap = new Map(plans.map((p) => [p.id, p.name]));

    // Also compute total per plan for context
    const totalsGroup = await this.prisma.garageSubscription.groupBy({
      by: ['plan_id'],
      _count: { plan_id: true },
      where: { plan_id: { in: planIds } },
    });
    const totalsMap = new Map(
      totalsGroup.map((t) => [t.plan_id, t._count.plan_id]),
    );

    const top_plans_by_ready = readyGroup.map((g) => ({
      plan_id: g.plan_id,
      plan_name: planNameMap.get(g.plan_id) || 'Unknown',
      ready_to_migrate: g._count.plan_id,
      total: totalsMap.get(g.plan_id) || 0,
    }));

    return {
      plans_total,
      subs_total,
      grandfathered,
      notice_sent,
      ready_to_migrate,
      migrated,
      top_plans_by_ready,
    };
  }
}
