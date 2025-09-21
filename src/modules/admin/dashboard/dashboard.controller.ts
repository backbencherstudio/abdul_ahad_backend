import {
  Controller,
  Get,
  UseGuards,
  Req,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { AbilitiesGuard } from 'src/ability/abilities.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { CheckAbilities } from 'src/ability/abilities.decorator';
import { Action } from 'src/ability/ability.factory';

@ApiTags('Admin Dashboard')
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: 'Get admin dashboard overview' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Dashboard' })
  async getDashboard(@Req() req) {
    return this.dashboardService.getDashboardOverview();
  }

  @ApiOperation({ summary: 'Get dashboard analytics' })
  @Get('analytics')
  @CheckAbilities({ action: Action.Read, subject: 'Analytics' })
  async getAnalytics(
    @Query('period') period: string = '30d',
    @Query('type') type?: string,
  ) {
    return this.dashboardService.getAnalytics(period, type);
  }
}
