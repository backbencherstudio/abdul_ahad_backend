import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { AbilitiesGuard } from 'src/ability/abilities.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { CheckAbilities } from 'src/ability/abilities.decorator';
import { Action } from 'src/ability/ability.factory';
import { GarageSubscriptionService } from './garage-subscription.service';
import { SubscriptionQueryDto } from './dto/subscription-query.dto';
import { GarageSubscriptionResponseDto } from './dto/garage-subscription-response.dto';
import { UpdateGarageSubscriptionDto } from './dto/update-garage-subscription.dto';
import { SubscriptionStatusService } from './subscription-status.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';


@ApiTags('Admin Garage Subscriptions')
@Controller('admin/subscription/garages')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class GarageSubscriptionController {
  constructor(
    private readonly garageSubscriptionService: GarageSubscriptionService,
    private readonly subscriptionStatusService: SubscriptionStatusService,
    private readonly subscriptionAnalyticsService: SubscriptionAnalyticsService,
  ) {}

  @ApiOperation({ summary: 'Get all garage subscriptions with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Garage subscriptions retrieved successfully',
  })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async getAllGarageSubscriptions(@Query() query: SubscriptionQueryDto) {
    return this.garageSubscriptionService.getAllGarageSubscriptions(query);
  }

  @ApiOperation({ summary: 'Get subscription analytics and revenue' })
  @ApiResponse({
    status: 200,
    description: 'Subscription analytics retrieved successfully',
  })
  @Get('analytics')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getSubscriptionAnalytics() {
    return this.garageSubscriptionService.getSubscriptionAnalytics();
  }

  @ApiOperation({ summary: 'Get garage subscription by ID' })
  @ApiResponse({
    status: 200,
    description: 'Garage subscription retrieved successfully',
    type: GarageSubscriptionResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Garage subscription not found',
  })
  @ApiParam({ name: 'id', description: 'Garage subscription ID' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Subscription' })
  async getGarageSubscriptionById(
    @Param('id') id: string,
  ): Promise<GarageSubscriptionResponseDto> {
    return this.garageSubscriptionService.getGarageSubscriptionById(id);
  }

  @ApiOperation({ summary: 'Get subscription history for a garage' })
  @ApiResponse({
    status: 200,
    description: 'Garage subscription history retrieved successfully',
    type: [GarageSubscriptionResponseDto],
  })
  @ApiParam({ name: 'garageId', description: 'Garage ID' })
  @Get('garage/:garageId/history')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async getGarageSubscriptionHistory(
    @Param('garageId') garageId: string,
  ): Promise<GarageSubscriptionResponseDto[]> {
    return this.garageSubscriptionService.getGarageSubscriptionHistory(
      garageId,
    );
  }

  @ApiOperation({
    summary:
      'Update garage subscription (activate, suspend, cancel, reactivate)',
    description:
      'Admin can manage garage subscription status and billing cycles',
  })
  @ApiResponse({
    status: 200,
    description: 'Garage subscription updated successfully',
    type: GarageSubscriptionResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Garage subscription not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid action or subscription already in target state',
  })
  @ApiParam({ name: 'id', description: 'Garage subscription ID' })
  @Put(':id')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async updateGarageSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateGarageSubscriptionDto,
  ): Promise<GarageSubscriptionResponseDto> {
    return this.garageSubscriptionService.updateGarageSubscription(id, dto);
  }

  @ApiOperation({ summary: 'Get subscription health summary' })
  @Get('health')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getSubscriptionHealth() {
    return this.subscriptionStatusService.getSubscriptionHealthSummary();
  }

  @ApiOperation({ summary: 'Get subscription status breakdown' })
  @Get('analytics/status-breakdown')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getSubscriptionStatusBreakdown() {
    return this.subscriptionAnalyticsService.getSubscriptionStatusBreakdown();
  }

  @ApiOperation({ summary: 'Get recent subscription activity' })
  @Get('analytics/recent-activity')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getRecentSubscriptionActivity(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.subscriptionAnalyticsService.getRecentSubscriptionActivity(
      limitNum,
    );
  }

  @ApiOperation({ summary: 'Get monthly revenue trend' })
  @Get('analytics/revenue-trend')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getMonthlyRevenueTrend() {
    return this.subscriptionAnalyticsService.getMonthlyRevenueTrend();
  }
}
