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
  Req,
  BadRequestException,
  InternalServerErrorException,
  Logger,
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
import { PriceMigrationService } from './migration/price-migration.service';
import { PriceMigrationCron } from './migration/price-migration.cron';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';
import appConfig from '../../../config/app.config';

@ApiTags('Admin Subscription Plans')
@Controller('admin/subscription/plans')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class SubscriptionPlanController {
  private readonly logger = new Logger(SubscriptionPlanController.name);

  constructor(
    private readonly subscriptionPlanService: SubscriptionPlanService,
    private readonly priceMigrationService: PriceMigrationService,
    private readonly priceMigrationCron: PriceMigrationCron,
    private readonly subscriptionAnalyticsService: SubscriptionAnalyticsService,
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

  // ===== Minimal Migration Endpoints =====
  @ApiOperation({ summary: 'Create and link a new Stripe price for this plan' })
  @Post(':id/migration/price')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async createNewPrice(
    @Param('id') id: string,
    @Body() body: { new_price_pence: number },
  ) {
    return this.priceMigrationService.createNewPriceVersion(
      id,
      Number(body.new_price_pence),
    );
  }

  @ApiOperation({
    summary: 'Send notices and schedule migration (default 30 days)',
  })
  @Post(':id/migration/notices')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async sendNotices(
    @Param('id') id: string,
    @Body() body: { notice_period_days?: number },
  ) {
    return this.priceMigrationService.sendMigrationNotices(
      id,
      body?.notice_period_days ?? 30,
    );
  }

  @ApiOperation({ summary: 'Bulk migrate ready subscriptions for this plan' })
  @Post(':id/migration/bulk')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async bulkMigrate(
    @Param('id') id: string,
    @Body() body: { batch_size?: number },
  ) {
    return this.priceMigrationService.bulkMigrateReady(
      id,
      body?.batch_size ?? 50,
      false, // Default to normal behavior (respect date check)
    );
  }

  @ApiOperation({ summary: 'Get migration status snapshot for this plan' })
  @Get(':id/migration/status')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async migrationStatus(@Param('id') id: string) {
    return this.priceMigrationService.getMigrationStatus(id);
  }

  // ===== Global Migration Analytics =====
  @ApiOperation({ summary: 'Get global migration summary across all plans' })
  @Get('migration/summary')
  @CheckAbilities({ action: Action.Read, subject: 'Subscription' })
  async getGlobalMigrationSummary() {
    return this.subscriptionAnalyticsService.getGlobalMigrationSummary();
  }

  // ===== Development Testing Endpoint =====
  @ApiOperation({
    summary: 'Manually trigger price migration cron (Development Only)',
    description:
      'This endpoint is only available in development environment. Triggers the price migration cron job immediately for testing purposes. Optionally bypass date check to process all grandfathered subscriptions regardless of scheduled date.',
  })
  @ApiResponse({
    status: 200,
    description: 'Migration cron executed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Price migration cron executed manually',
        },
        environment: { type: 'string', example: 'development' },
        triggered_by: { type: 'string', example: 'admin@example.com' },
        timestamp: { type: 'string', example: '2025-10-02T06:30:00.000Z' },
        bypassed_date_check: { type: 'boolean', example: false },
        note: {
          type: 'string',
          example:
            'This is a development-only endpoint. Production uses automatic cron scheduling.',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Endpoint not available in production environment',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'string',
          example: 'This endpoint is only available in development environment',
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @Post('trigger-price-migration')
  @CheckAbilities({ action: Action.Update, subject: 'Subscription' })
  async triggerPriceMigration(
    @Req() req,
    @Body() body?: { bypass_date_check?: boolean },
  ) {
    // Environment check using app.config.ts
    const config = appConfig();
    const isDevelopment = config.app.node_env?.toLowerCase() === 'development';

    if (!isDevelopment) {
      throw new BadRequestException(
        'This endpoint is only available in development environment. ' +
          'Production migrations run automatically via cron job at 2:00 AM daily.',
      );
    }

    try {
      const bypassDateCheck = body?.bypass_date_check || false;

      this.logger.log(
        `🚀 MANUAL MIGRATION TRIGGERED by ${req.user?.email || 'unknown'} at ${new Date().toISOString()} (bypass date check: ${bypassDateCheck})`,
      );

      // Execute the cron job manually with bypass option
      await this.priceMigrationCron.handleDailyBulkMigrate({
        bypassDateCheck: bypassDateCheck,
      });

      this.logger.log('✅ Manual migration execution completed successfully');

      return {
        success: true,
        message: 'Price migration cron executed manually',
        environment: config.app.node_env,
        triggered_by: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
        bypassed_date_check: bypassDateCheck,
        note: bypassDateCheck
          ? 'Date check bypassed for testing. All grandfathered subscriptions processed regardless of scheduled date.'
          : 'This is a development-only endpoint. Production uses automatic cron scheduling.',
      };
    } catch (error) {
      this.logger.error('❌ Manual migration trigger failed:', error);
      throw new InternalServerErrorException(
        'Migration execution failed: ' + error.message,
      );
    }
  }
}
