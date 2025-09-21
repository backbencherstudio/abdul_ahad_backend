import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
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
import { SubscriptionPlanService } from './subscription-plan.service';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

@ApiTags('Admin Subscription Plans')
@Controller('admin/subscription/plans')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class SubscriptionPlanController {
  constructor(
    private readonly subscriptionPlanService: SubscriptionPlanService,
  ) {}

  @ApiOperation({ summary: 'Create new subscription plan' })
  @ApiResponse({
    status: 201,
    description: 'Subscription plan created successfully',
    type: SubscriptionPlanResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid plan data or name already exists',
  })
  @ApiResponse({
    status: 409,
    description: 'Plan name already exists',
  })
  @Post()
  @CheckAbilities({ action: Action.Create, subject: 'Subscription' })
  async createPlan(
    @Body() dto: CreateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.subscriptionPlanService.createPlan(dto);
  }

  @ApiOperation({ summary: 'Get all subscription plans with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Subscription plans retrieved successfully',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async getAllPlans(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    return this.subscriptionPlanService.getAllPlans(page, limit);
  }

  @ApiOperation({
    summary: 'Get active subscription plans (for garage selection)',
  })
  @ApiResponse({
    status: 200,
    description: 'Active subscription plans retrieved successfully',
    type: [SubscriptionPlanResponseDto],
  })
  @Get('active')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async getActivePlans(): Promise<SubscriptionPlanResponseDto[]> {
    return this.subscriptionPlanService.getActivePlans();
  }

  @ApiOperation({ summary: 'Get subscription plan by ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan retrieved successfully',
    type: SubscriptionPlanResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription plan not found',
  })
  @ApiParam({ name: 'id', description: 'Subscription plan ID' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Subscription' })
  async getPlanById(
    @Param('id') id: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.subscriptionPlanService.getPlanById(id);
  }

  @ApiOperation({ summary: 'Update subscription plan' })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan updated successfully',
    type: SubscriptionPlanResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription plan not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Plan name already exists',
  })
  @ApiParam({ name: 'id', description: 'Subscription plan ID' })
  @Put(':id')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.subscriptionPlanService.updatePlan(id, dto);
  }

  @ApiOperation({ summary: 'Delete subscription plan' })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription plan not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete plan with active subscriptions',
  })
  @ApiParam({ name: 'id', description: 'Subscription plan ID' })
  @Delete(':id')
  @CheckAbilities({ action: Action.Delete, subject: 'Subscription' })
  async deletePlan(@Param('id') id: string) {
    return this.subscriptionPlanService.deletePlan(id);
  }

  @ApiOperation({ summary: 'Sync plan to Stripe (create Price if missing)' })
  @Post(':id/stripe/sync')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async syncStripe(@Param('id') id: string) {
    return this.subscriptionPlanService.syncStripePrice(id);
  }
}
