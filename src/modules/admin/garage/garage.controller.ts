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
import { GarageService } from './garage.service';

@ApiTags('Admin Garage Management')
@Controller('admin/garage')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @ApiOperation({ summary: 'Get all garages (admin view)' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Garage' })
  async getGarages(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      throw new BadRequestException('Invalid page or limit parameters');
    }
    console.log('pageNum', pageNum);
    console.log('limitNum', limitNum);
    console.log('status', status);
    return this.garageService.getGarages(pageNum, limitNum, status);
  }

  @ApiOperation({ summary: 'Get garage details by ID' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Garage' })
  async getGarage(@Param('id') id: string) {
    return this.garageService.getGarageById(id);
  }

  @ApiOperation({ summary: 'Approve garage' })
  @Patch(':id/approve')
  @CheckAbilities({ action: Action.Approve, subject: 'Garage' })
  async approveGarage(@Param('id') id: string) {
    return this.garageService.approveGarage(id);
  }

  @ApiOperation({ summary: 'Reject garage' })
  @Patch(':id/reject')
  @CheckAbilities({ action: Action.Update, subject: 'Garage' })
  async rejectGarage(@Param('id') id: string) {
    return this.garageService.rejectGarage(id);
  }
}
