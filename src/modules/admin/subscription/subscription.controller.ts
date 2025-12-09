import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  UseGuards,
  Query,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { AbilitiesGuard } from 'src/ability/abilities.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { CheckAbilities } from 'src/ability/abilities.decorator';
import { Action } from 'src/ability/ability.factory';
// import { SubscriptionService } from './subscription.service';
import { PriceMigrationService } from './migration/price-migration.service';

@ApiTags('Admin Subscription Management')
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    // private readonly subscriptionService: SubscriptionService,
    private readonly priceMigrationService: PriceMigrationService,
  ) {}

  // @ApiOperation({ summary: 'List subscription plans' })
  // @Get('plans')
  // @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  // async listPlans(
  //   @Query('page') page: string = '1',
  //   @Query('limit') limit: string = '10',
  // ) {
  //   const p = parseInt(page, 10);
  //   const l = parseInt(limit, 10);
  //   if (isNaN(p) || isNaN(l) || p < 1 || l < 1) {
  //     throw new BadRequestException('Invalid page or limit parameters');
  //   }
  //   return this.subscriptionService.listPlans(p, l);
  // }

  // @ApiOperation({ summary: 'Create subscription plan' })
  // @Post('plans')
  // @CheckAbilities({ action: Action.Create, subject: 'Subscription' })
  // async createPlan(
  //   @Body()
  //   dto: {
  //     name: string;
  //     price: number;
  //     currency?: string;
  //     duration_months: number;
  //     features?: any;
  //     is_active?: boolean;
  //   },
  // ) {
  //   return this.subscriptionService.createPlan(dto);
  // }

  // @ApiOperation({ summary: 'Update subscription plan' })
  // @Put('plans/:id')
  // @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  // async updatePlan(
  //   @Param('id') id: string,
  //   @Body()
  //   dto: Partial<{
  //     name: string;
  //     price: number;
  //     currency?: string;
  //     duration_months: number;
  //     features?: any;
  //     is_active?: boolean;
  //   }>,
  // ) {
  //   return this.subscriptionService.updatePlan(id, dto);
  // }

  // @ApiOperation({ summary: 'Delete subscription plan' })
  // @Delete('plans/:id')
  // @CheckAbilities({ action: Action.Delete, subject: 'Subscription' })
  // async deletePlan(@Param('id') id: string) {
  //   return this.subscriptionService.deletePlan(id);
  // }

  // @ApiOperation({ summary: 'List garage subscriptions' })
  // @Get('garages')
  // @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  // async listGarageSubscriptions(
  //   @Query('page') page: string = '1',
  //   @Query('limit') limit: string = '10',
  //   @Query('status') status?: string,
  // ) {
  //   const p = parseInt(page, 10);
  //   const l = parseInt(limit, 10);
  //   if (isNaN(p) || isNaN(l) || p < 1 || l < 1) {
  //     throw new BadRequestException('Invalid page or limit parameters');
  //   }
  //   return this.subscriptionService.listGarageSubscriptions(p, l, status);
  // }

  // @ApiOperation({ summary: 'Get garage subscription history' })
  // @Get('garages/:garageId/history')
  // @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  // async getGarageSubscriptionHistory(@Param('garageId') garageId: string) {
  //   return this.subscriptionService.getGarageSubscriptionHistory(garageId);
  // }

  // ===== Minimal manual migration endpoint (single subscription) =====
  @ApiOperation({
    summary:
      "Manually migrate a single subscription to the plan's current price",
  })
  @Post(':subscriptionId/migration')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async migrateSingle(@Param('subscriptionId') subscriptionId: string) {
    return this.priceMigrationService.migrateCustomer(subscriptionId);
  }
}
