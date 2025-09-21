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
}
