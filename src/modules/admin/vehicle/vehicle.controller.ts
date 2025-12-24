import {
  Controller,
  Get,
  UseGuards,
  Query,
  BadRequestException,
  Delete,
  Param,
  Body,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { AbilitiesGuard } from 'src/ability/abilities.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { CheckAbilities } from 'src/ability/abilities.decorator';
import { Action } from 'src/ability/ability.factory';
import { VehicleService } from './vehicle.service';
import { GetAllQueryDto } from './dto/query-vehicle.dto';
import { UpdateMotReminderSettingsDto } from './dto/update-mot-reminder.dto';
@ApiTags('Admin Vehicle Management')
@Controller('admin/vehicle')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @ApiOperation({ summary: 'Get all vehicles (admin view)' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Driver' })
  async getVehicles(@Query() query: GetAllQueryDto) {
    const {
      page,
      limit,
      expiry_status,
      search,
      startdate,
      enddate,
      sort_by_expiry,
    } = query;

    return this.vehicleService.getVehicles(
      page,
      limit,
      expiry_status,
      search,
      startdate,
      enddate,
      sort_by_expiry,
    );
  }

  @ApiOperation({ summary: 'Delete a vehicle' })
  @Delete(':id')
  @CheckAbilities({ action: Action.Delete, subject: 'Driver' })
  async deleteVehicle(@Param('id') id: string) {
    return this.vehicleService.deleteVehicle(id);
  }

  @Get('reminder-settings')
  @ApiOperation({ summary: 'Get MOT reminder settings (Admin only)' })
  async getMotReminderSettings() {
    return this.vehicleService.getMotReminderSettings();
  }

  @Patch('reminder-settings')
  @ApiOperation({ summary: 'Update MOT reminder settings (Admin only)' })
  async updateMotReminderSettings(@Body() dto: UpdateMotReminderSettingsDto) {
    return this.vehicleService.updateMotReminderSettings(dto);
  }
}
