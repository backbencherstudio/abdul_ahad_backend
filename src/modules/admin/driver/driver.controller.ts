import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Query,
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
import { DriverService } from './driver.service';

@ApiTags('Admin Driver Management')
@Controller('admin/driver')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @ApiOperation({ summary: 'Get all drivers (admin view)' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Driver' })
  async getDrivers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      throw new BadRequestException('Invalid page or limit parameters');
    }

    return this.driverService.getDrivers(pageNum, limitNum, status);
  }

  @ApiOperation({ summary: 'Get driver details by ID' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Driver' })
  async getDriver(@Param('id') id: string) {
    return this.driverService.getDriverById(id);
  }

  @ApiOperation({ summary: 'Approve driver' })
  @Patch(':id/approve')
  @CheckAbilities({ action: Action.Approve, subject: 'Driver' })
  async approveDriver(@Param('id') id: string) {
    return this.driverService.approveDriver(id);
  }

  @ApiOperation({ summary: 'Reject driver' })
  @Patch(':id/reject')
  @CheckAbilities({ action: Action.Update, subject: 'Driver' })
  async rejectDriver(@Param('id') id: string) {
    return this.driverService.rejectDriver(id);
  }
}
