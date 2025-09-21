import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SubscriptionQueryDto,
  SubscriptionStatus,
} from './dto/subscription-query.dto';
import { GarageSubscriptionResponseDto } from './dto/garage-subscription-response.dto';
import {
  UpdateGarageSubscriptionDto,
  GarageSubscriptionAction,
} from './dto/update-garage-subscription.dto';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';

@Injectable()
export class GarageSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async attachStripeSubscription(id: string) {
    const sub = await this.prisma.garageSubscription.findUnique({
      where: { id },
      include: {
        garage: {
          select: { id: true, email: true, name: true, billing_id: true },
        },
        plan: {
          select: {
            id: true,
            name: true,
            stripe_price_id: true,
            currency: true,
            price_pence: true,
          },
        },
      },
    });
    if (!sub) throw new NotFoundException('Garage subscription not found');
    if (!sub.plan.stripe_price_id)
      throw new BadRequestException('Plan not synced to Stripe');

    // Ensure customer (reuse existing billing_id if present)
    let stripeCustomerId = sub.stripe_customer_id || sub.garage.billing_id;
    if (!stripeCustomerId) {
      const customer = await StripePayment.createCustomer({
        user_id: sub.garage.id,
        name: sub.garage.name || undefined,
        email: sub.garage.email || undefined,
      });
      stripeCustomerId = customer.id;

      await this.prisma.user.update({
        where: { id: sub.garage.id },
        data: { billing_id: stripeCustomerId },
      });
    }

    if (sub.stripe_subscription_id) {
      return {
        success: true,
        message: 'Stripe subscription already attached',
        stripe_subscription_id: sub.stripe_subscription_id,
        stripe_customer_id: stripeCustomerId,
      };
    }

    const created = await StripePayment.createSubscription({
      customer: stripeCustomerId,
      price: sub.plan.stripe_price_id!,
      metadata: {
        garage_subscription_id: sub.id,
        plan_id: sub.plan.id,
        garage_id: sub.garage.id,
      },
    });

    await this.prisma.garageSubscription.update({
      where: { id: sub.id },
      data: {
        stripe_subscription_id: created.id,
        stripe_customer_id: stripeCustomerId,
      },
    });

    return {
      success: true,
      message: 'Stripe subscription attached',
      stripe_subscription_id: created.id,
      stripe_customer_id: stripeCustomerId,
    };
  }

  async cancelStripeSubscription(id: string) {
    const sub = await this.prisma.garageSubscription.findUnique({
      where: { id },
    });
    if (!sub) throw new NotFoundException('Garage subscription not found');
    if (!sub.stripe_subscription_id)
      throw new BadRequestException('No Stripe subscription linked');

    await StripePayment.cancelSubscription(sub.stripe_subscription_id);

    return { success: true, message: 'Stripe subscription cancelled' };
  }

  /**
   * Get all garage subscriptions with filtering and pagination
   */
  async getAllGarageSubscriptions(query: SubscriptionQueryDto): Promise<{
    data: GarageSubscriptionResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      page = 1,
      limit = 20,
      status,
      plan_id,
      search,
      created_after,
      created_before,
    } = query;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (plan_id) {
      where.plan_id = plan_id;
    }

    if (search) {
      where.OR = [
        { garage: { garage_name: { contains: search, mode: 'insensitive' } } },
        { garage: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (created_after || created_before) {
      where.created_at = {};
      if (created_after) {
        where.created_at.gte = new Date(created_after);
      }
      if (created_before) {
        where.created_at.lte = new Date(created_before);
      }
    }

    const [subscriptions, total] = await Promise.all([
      this.prisma.garageSubscription.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          garage: {
            select: {
              id: true,
              garage_name: true,
              email: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.garageSubscription.count({ where }),
    ]);

    const formattedSubscriptions = subscriptions.map((sub) =>
      this.formatSubscriptionResponse(sub),
    );

    return {
      data: formattedSubscriptions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get garage subscription by ID
   */
  async getGarageSubscriptionById(
    id: string,
  ): Promise<GarageSubscriptionResponseDto> {
    const subscription = await this.prisma.garageSubscription.findUnique({
      where: { id },
      include: {
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Garage subscription with ID '${id}' not found`,
      );
    }

    return this.formatSubscriptionResponse(subscription);
  }

  /**
   * Get subscription history for a garage
   */
  async getGarageSubscriptionHistory(
    garageId: string,
  ): Promise<GarageSubscriptionResponseDto[]> {
    const subscriptions = await this.prisma.garageSubscription.findMany({
      where: { garage_id: garageId },
      orderBy: { created_at: 'desc' },
      include: {
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return subscriptions.map((sub) => this.formatSubscriptionResponse(sub));
  }

  /**
   * Update garage subscription (activate, suspend, cancel, reactivate)
   */
  async updateGarageSubscription(
    id: string,
    dto: UpdateGarageSubscriptionDto,
  ): Promise<GarageSubscriptionResponseDto> {
    const subscription = await this.prisma.garageSubscription.findUnique({
      where: { id },
      include: {
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Garage subscription with ID '${id}' not found`,
      );
    }

    let updateData: any = {};

    switch (dto.action) {
      case GarageSubscriptionAction.ACTIVATE:
        if (subscription.status === 'ACTIVE') {
          throw new BadRequestException('Subscription is already active');
        }
        updateData = {
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: this.calculatePeriodEnd(new Date()),
          next_billing_date: this.calculateNextBilling(new Date()),
        };
        break;

      case GarageSubscriptionAction.SUSPEND:
        if (subscription.status === 'SUSPENDED') {
          throw new BadRequestException('Subscription is already suspended');
        }
        updateData = {
          status: 'SUSPENDED',
        };
        break;

      case GarageSubscriptionAction.CANCEL:
        if (subscription.status === 'CANCELLED') {
          throw new BadRequestException('Subscription is already cancelled');
        }
        updateData = {
          status: 'CANCELLED',
          current_period_end: new Date(), // End immediately
        };
        break;

      case GarageSubscriptionAction.REACTIVATE:
        if (subscription.status === 'ACTIVE') {
          throw new BadRequestException('Subscription is already active');
        }
        updateData = {
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: this.calculatePeriodEnd(new Date()),
          next_billing_date: this.calculateNextBilling(new Date()),
        };
        break;

      default:
        throw new BadRequestException(`Invalid action: ${dto.action}`);
    }

    const updatedSubscription = await this.prisma.garageSubscription.update({
      where: { id },
      data: {
        ...updateData,
        updated_at: new Date(),
      },
      include: {
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return this.formatSubscriptionResponse(updatedSubscription);
  }

  /**
   * Get subscription analytics
   */
  async getSubscriptionAnalytics(): Promise<{
    total_active_subscriptions: number;
    total_monthly_revenue_pence: number;
    total_monthly_revenue_formatted: string;
    status_distribution: {
      status: string;
      count: number;
      percentage: number;
    }[];
    plan_distribution: {
      plan_name: string;
      count: number;
      percentage: number;
      revenue_pence: number;
    }[];
  }> {
    const [totalActive, totalRevenue, statusDistribution, planDistribution] =
      await Promise.all([
        this.prisma.garageSubscription.count({
          where: { status: 'ACTIVE' },
        }),
        this.prisma.garageSubscription.aggregate({
          where: { status: 'ACTIVE' },
          _sum: { price_pence: true },
        }),
        this.prisma.garageSubscription.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.garageSubscription.groupBy({
          by: ['plan_id'],
          where: { status: 'ACTIVE' },
          _count: { plan_id: true },
          _sum: { price_pence: true },
        }),
      ]);

    // Get plan names for distribution
    const planIds = planDistribution.map((p) => p.plan_id);
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true },
    });

    const planMap = new Map(plans.map((p) => [p.id, p.name]));

    const totalSubscriptions = await this.prisma.garageSubscription.count();

    return {
      total_active_subscriptions: totalActive,
      total_monthly_revenue_pence: totalRevenue._sum.price_pence || 0,
      total_monthly_revenue_formatted: this.formatPrice(
        totalRevenue._sum.price_pence || 0,
      ),
      status_distribution: statusDistribution.map((s) => ({
        status: s.status,
        count: s._count.status,
        percentage: Math.round((s._count.status / totalSubscriptions) * 100),
      })),
      plan_distribution: planDistribution.map((p) => ({
        plan_name: planMap.get(p.plan_id) || 'Unknown',
        count: p._count.plan_id,
        percentage: Math.round((p._count.plan_id / totalActive) * 100),
        revenue_pence: p._sum.price_pence || 0,
      })),
    };
  }

  /**
   * Format subscription response
   */
  private formatSubscriptionResponse(
    subscription: any,
  ): GarageSubscriptionResponseDto {
    return {
      id: subscription.id,
      garage_id: subscription.garage_id,
      garage_name: subscription.garage.garage_name || 'Unknown Garage',
      garage_email: subscription.garage.email || 'No email',
      plan_id: subscription.plan_id,
      plan_name: subscription.plan.name,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      next_billing_date: subscription.next_billing_date,
      price_pence: subscription.price_pence,
      price_formatted: this.formatPrice(
        subscription.price_pence,
        subscription.currency,
      ),
      stripe_subscription_id: subscription.stripe_subscription_id,
      stripe_customer_id: subscription.stripe_customer_id,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
    };
  }

  /**
   * Calculate period end date (30 days from start)
   */
  private calculatePeriodEnd(startDate: Date): Date {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);
    return endDate;
  }

  /**
   * Calculate next billing date (30 days from start)
   */
  private calculateNextBilling(startDate: Date): Date {
    return this.calculatePeriodEnd(startDate);
  }

  /**
   * Format price in pence to currency string
   */
  private formatPrice(pricePence: number, currency: string = 'GBP'): string {
    const amount = pricePence / 100;

    switch (currency) {
      case 'GBP':
        return `£${amount.toFixed(2)}`;
      case 'USD':
        return `$${amount.toFixed(2)}`;
      case 'EUR':
        return `€${amount.toFixed(2)}`;
      default:
        return `${amount.toFixed(2)} ${currency}`;
    }
  }
}
