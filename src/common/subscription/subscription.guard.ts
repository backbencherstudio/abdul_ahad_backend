import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Skip check for admin users
    if (user?.type === 'ADMIN') {
      return true;
    }

    // Only check for garage users
    if (user?.type !== 'GARAGE') {
      return true;
    }

    const garageId = user.userId;

    // Check if garage has active subscription
    const subscription = await this.prisma.garageSubscription.findFirst({
      where: {
        garage_id: garageId,
        status: 'ACTIVE',
        current_period_end: {
          gte: new Date(),
        },
      },
    });

    if (!subscription) {
      throw new ForbiddenException(
        'Active subscription required. Please contact admin to activate your subscription.',
      );
    }

    return true;
  }
}
