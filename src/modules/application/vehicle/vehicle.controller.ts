import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { VehicleService } from './vehicle.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Post()
  async addVehicle(@Req() req, @Body() dto: CreateVehicleDto) {
    return this.vehicleService.addVehicle(req.user.userId, dto);
  }

  @Get()
  async listVehicles(@Req() req) {
    return this.vehicleService.getVehiclesByUser(req.user.userId); // FIXED
  }

  @Get('mot-report/:reportId')
  async getMotReport(@Param('reportId') reportId: string) {
    return this.vehicleService.getMotReportWithDefects(reportId);
  }
  @Get(':vehicleId/mot-reports')
  async getMotReports(@Param('vehicleId') vehicleId: string) {
    return this.vehicleService.getCompleteMotHistory(vehicleId);
  }

  @Get(':id')
  async getVehicle(@Req() req, @Param('id') id: string) {
    return this.vehicleService.getVehicleById(req.user.id, id); // FIXED
  }

  @Delete(':id')
  async deleteVehicle(@Req() req, @Param('id') id: string) {
    return this.vehicleService.deleteVehicle(req.user.userId, id);
  }

  @Patch(':id')
  async updateVehicle(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicleService.updateVehicle(req.user.userId, id, dto);
  }
}
