import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardOverview() {
    // Get basic counts for dashboard
    const [totalGarages, totalDrivers, totalBookings, totalPayments] =
      await Promise.all([
        this.prisma.user.count({ where: { type: 'GARAGE' } }),
        this.prisma.user.count({ where: { type: 'DRIVER' } }),
        this.prisma.order.count(),
        this.prisma.paymentTransaction.count(),
      ]);

    return {
      success: true,
      data: {
        overview: {
          total_garages: totalGarages,
          total_drivers: totalDrivers,
          total_bookings: totalBookings,
          total_payments: totalPayments,
          active_subscriptions: 0, // TODO: Will be implemented when subscription model is added
        },
        last_updated: new Date().toISOString(),
      },
    };
  }

  async getAnalytics(period: string, type?: string) {
    // TODO: Will be implemented with proper analytics
    return {
      success: true,
      data: {
        period,
        type,
        metrics: {
          revenue: 0,
          bookings: 0,
          active_garages: 0,
          active_drivers: 0,
        },
        charts: [],
      },
    };
  }
}
