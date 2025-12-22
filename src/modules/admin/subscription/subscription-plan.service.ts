import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class SubscriptionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create a new subscription plan
   */
  async createPlan(
    dto: CreateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    // Check if any plan already exists (only one plan allowed)
    const planCount = await this.prisma.subscriptionPlan.count();

    if (planCount > 0) {
      throw new ConflictException(
        'Only one subscription plan is allowed in the system. Please update the existing plan instead.',
      );
    }

    // Check if plan name already exists
    const existingPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { name: dto.name },
    });

    if (existingPlan) {
      throw new ConflictException(
        `Plan with name '${dto.name}' already exists`,
      );
    }

    // ✅ CREATE DATABASE RECORD FIRST
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        description: dto.description,
        price_pence: dto.price_pence,
        currency: dto.currency || 'GBP',
        max_bookings_per_month: dto.max_bookings_per_month,
        max_vehicles: dto.max_vehicles,
        priority_support: dto.priority_support || false,
        advanced_analytics: dto.advanced_analytics || false,
        custom_branding: dto.custom_branding || false,
        is_active: dto.is_active !== undefined ? dto.is_active : true,
        trial_period_days:
          dto.trial_period_days !== undefined ? dto.trial_period_days : 14,
        features: dto.features || [],
      },
    });

    // ✅ AUTO-SYNC WITH STRIPE
    try {
      const product = await StripePayment.createProduct({
        name: plan.name,
        active: plan.is_active,
      });

      const price = await StripePayment.createPrice({
        unit_amount: plan.price_pence,
        currency: plan.currency || 'GBP',
        product: product.id,
        recurring_interval: 'month',
        metadata: {
          plan_id: plan.id,
          max_bookings_per_month: String(plan.max_bookings_per_month),
          max_vehicles: String(plan.max_vehicles),
        },
      });

      // ✅ UPDATE PLAN WITH STRIPE IDs
      const updatedPlan = await this.prisma.subscriptionPlan.update({
        where: { id: plan.id },
        data: {
          stripe_price_id: price.id,
          stripe_product_id: product.id, // Add this field if it exists in your schema
        },
      });

      try {
        await this.notificationService.sendToAllAdmins({
          type: 'subscription_plan',
          title: 'New Subscription Plan Created',
          message: `New subscription plan "${dto.name}" has been created with price £${(dto.price_pence / 100).toFixed(2)}/month. Successfully synced to Stripe.`,
          metadata: {
            plan_id: updatedPlan.id,
            plan_name: dto.name,
            price_pence: dto.price_pence,
            stripe_synced: true,
          },
        });
      } catch (notificationError) {
        //console.error(
        //  'Failed to send new plan created notification:',
        //  notificationError,
        //);
      }

      return this.formatPlanResponse(updatedPlan);
    } catch (error) {
      //console.error('Failed to sync with Stripe:', error);

      // Notify admins about Stripe sync failure
      try {
        await this.notificationService.notifyStripeSyncFailed({
          planId: plan.id,
          planName: plan.name,
          operation: 'create price and product',
          errorMessage: error.message || 'Unknown error',
        });

        await this.notificationService.sendToAllAdmins({
          type: 'subscription_plan',
          title: 'New Subscription Plan Created (Stripe Sync Failed)',
          message: `New subscription plan "${dto.name}" has been created with price £${(dto.price_pence / 100).toFixed(2)}/month, but failed to sync with Stripe. Error: ${error.message || 'Unknown error'}`,
          metadata: {
            plan_id: plan.id,
            plan_name: dto.name,
            price_pence: dto.price_pence,
            stripe_synced: false,
            error_message: error.message || 'Unknown error',
          },
        });
      } catch (notificationError) {
        //console.error(
        //  'Failed to send new plan created (Stripe sync failed) notification:',
        //  notificationError,
        //);
      }

      // Return plan without Stripe sync (you can decide if you want to throw error)
      return this.formatPlanResponse(plan);
    }
  }

  /**
   * Get all subscription plans with pagination
   */
  async getAllPlans(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: SubscriptionPlanResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              garage_subscriptions: {
                where: { status: 'ACTIVE' },
              },
            },
          },
        },
      }),
      this.prisma.subscriptionPlan.count(),
    ]);

    const formattedPlans = plans.map((plan) =>
      this.formatPlanResponse(plan, plan._count.garage_subscriptions),
    );

    return {
      data: formattedPlans,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get subscription plan by ID
   */
  async getPlanById(id: string): Promise<SubscriptionPlanResponseDto> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            garage_subscriptions: {
              where: { status: 'ACTIVE' },
            },
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with ID '${id}' not found`,
      );
    }

    return this.formatPlanResponse(plan, plan._count.garage_subscriptions);
  }

  /**
   * Update subscription plan
   */
  async updatePlan(
    id: string,
    dto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    // Check if plan exists
    const existingPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      throw new NotFoundException(
        `Subscription plan with ID '${id}' not found`,
      );
    }

    // Check if name is being changed and if it conflicts
    if (dto.name && dto.name !== existingPlan.name) {
      const nameConflict = await this.prisma.subscriptionPlan.findFirst({
        where: {
          name: dto.name,
          id: { not: id },
        },
      });

      if (nameConflict) {
        throw new ConflictException(
          `Plan with name '${dto.name}' already exists`,
        );
      }
    }

    const updatedPlan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price_pence !== undefined && { price_pence: dto.price_pence }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.max_bookings_per_month !== undefined && {
          max_bookings_per_month: dto.max_bookings_per_month,
        }),
        ...(dto.max_vehicles !== undefined && {
          max_vehicles: dto.max_vehicles,
        }),
        ...(dto.priority_support !== undefined && {
          priority_support: dto.priority_support,
        }),
        ...(dto.advanced_analytics !== undefined && {
          advanced_analytics: dto.advanced_analytics,
        }),
        ...(dto.custom_branding !== undefined && {
          custom_branding: dto.custom_branding,
        }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.stripe_price_id !== undefined && {
          stripe_price_id: dto.stripe_price_id,
        }),
        ...(dto.trial_period_days !== undefined && {
          trial_period_days: dto.trial_period_days,
        }),
        ...(dto.features !== undefined && { features: dto.features }),
        updated_at: new Date(),
      },
      include: {
        _count: {
          select: {
            garage_subscriptions: {
              where: { status: 'ACTIVE' },
            },
          },
        },
      },
    });

    return this.formatPlanResponse(
      updatedPlan,
      updatedPlan._count.garage_subscriptions,
    );
  }

  /**
   * Delete subscription plan
   */
  async deletePlan(id: string): Promise<{ message: string }> {
    // Check if plan exists
    const existingPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            garage_subscriptions: true,
          },
        },
      },
    });

    if (!existingPlan) {
      throw new NotFoundException(
        `Subscription plan with ID '${id}' not found`,
      );
    }

    // Check if plan has active subscriptions
    if (existingPlan._count.garage_subscriptions > 0) {
      try {
        await this.notificationService.sendToAllAdmins({
          type: 'subscription_plan',
          title: 'Plan Deletion Blocked',
          message: `Attempted to delete plan "${existingPlan.name}" but it has ${existingPlan._count.garage_subscriptions} active subscriptions. Please migrate or cancel subscriptions first.`,
          metadata: {
            plan_id: id,
            plan_name: existingPlan.name,
            active_count: existingPlan._count.garage_subscriptions,
          },
        });
      } catch (notificationError) {
        //console.error(
        //  'Failed to send plan deletion blocked notification:',
        //  notificationError,
        //);
      }

      throw new BadRequestException(
        `Cannot delete plan '${existingPlan.name}' because it has ${existingPlan._count.garage_subscriptions} active subscription(s). Please deactivate the plan instead.`,
      );
    }

    await this.prisma.subscriptionPlan.delete({
      where: { id },
    });

    return {
      message: `Subscription plan '${existingPlan.name}' deleted successfully`,
    };
  }

  /**
   * Get active plans only (for garage subscription selection)
   */
  async getActivePlans(): Promise<SubscriptionPlanResponseDto[]> {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { is_active: true },
      orderBy: { price_pence: 'asc' },
      include: {
        _count: {
          select: {
            garage_subscriptions: {
              where: { status: 'ACTIVE' },
            },
          },
        },
      },
    });

    return plans.map((plan) =>
      this.formatPlanResponse(plan, plan._count.garage_subscriptions),
    );
  }

  /**
   * Format plan response with additional computed fields
   */
  private formatPlanResponse(
    plan: any,
    activeSubscriptionsCount: number = 0,
  ): SubscriptionPlanResponseDto {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price_pence: plan.price_pence,
      price_formatted: this.formatPrice(plan.price_pence, plan.currency),
      currency: plan.currency,
      max_bookings_per_month: plan.max_bookings_per_month,
      max_vehicles: plan.max_vehicles,
      priority_support: plan.priority_support,
      advanced_analytics: plan.advanced_analytics,
      custom_branding: plan.custom_branding,
      is_active: plan.is_active,
      trial_period_days: plan.trial_period_days,
      features: Array.isArray(plan.features) ? plan.features : [],
      stripe_price_id: plan.stripe_price_id,
      active_subscriptions_count: activeSubscriptionsCount,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
    };
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

  async syncStripePrice(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.is_active)
      throw new BadRequestException('Plan must be active to sync');

    if (plan.stripe_price_id) {
      return {
        success: true,
        message: 'Stripe price already linked',
        stripe_price_id: plan.stripe_price_id,
      };
    }

    const product = await StripePayment.createProduct({
      name: plan.name,
      active: plan.is_active,
    });

    const price = await StripePayment.createPrice({
      unit_amount: plan.price_pence,
      currency: plan.currency || 'GBP',
      product: product.id,
      recurring_interval: 'month',
      metadata: {
        plan_id: plan.id,
        max_bookings_per_month: String(plan.max_bookings_per_month),
        max_vehicles: String(plan.max_vehicles),
      },
    });

    await this.prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { stripe_price_id: price.id },
    });

    return {
      success: true,
      message: 'Stripe price synced',
      stripe_price_id: price.id,
    };
  }
}
