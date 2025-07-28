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
  Query,
} from '@nestjs/common';
import { VehicleService } from './vehicle.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { VehicleGarageService } from './vehicle-garage.service';
import { VehicleBookingService } from './vehicle-booking.service';
import { SearchGarageDto } from './dto/search-garage.dto';
import { BookSlotDto } from './dto/book-slot.dto';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Role } from 'src/common/guard/role/role.enum';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('Vehicles')
@ApiBearerAuth()
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly vehicleGarageService: VehicleGarageService,
    private readonly vehicleBookingService: VehicleBookingService,
  ) {}

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

  @Post('search-garages')
  @ApiOperation({
    summary: 'Search for garages by vehicle registration and postcode',
    description:
      'Validates the vehicle with DVLA and returns a list of active garages in the area.',
  })
  @ApiResponse({ status: 200, description: 'List of garages and vehicle info' })
  async searchGarages(@Req() req, @Body() dto: SearchGarageDto) {
    return this.vehicleBookingService.searchGaragesByPostcode(
      req.user.userId,
      dto,
    );
  }

  @Get('garages/:garageId/services')
  @ApiOperation({
    summary: 'Get bookable and additional services for a garage',
    description:
      'Returns MOT, Retest (bookable) and additional (showcase) services for a garage.',
  })
  @ApiResponse({ status: 200, description: 'Garage services' })
  async getGarageServices(@Param('garageId') garageId: string) {
    return this.vehicleGarageService.getGarageServices(garageId);
  }

  @Get('garages/:garageId/slots')
  @ApiOperation({
    summary: 'Get available slots for a garage on a specific date',
    description:
      'Returns all available slots for a garage on a given date (YYYY-MM-DD).',
  })
  @ApiResponse({ status: 200, description: 'List of available slots' })
  async getAvailableSlots(
    @Param('garageId') garageId: string,
    @Query('date') date: string,
  ) {
    return this.vehicleBookingService.getAvailableSlots(garageId, date);
  }

  @Post('book-slot')
  @Roles(Role.DRIVER)
  @ApiOperation({
    summary: 'Book a slot for MOT or Retest (no payment)',
    description:
      'Books a slot for MOT or Retest service. Only MOT and RETEST services are allowed. Payment is not handled at this stage.',
  })
  @ApiResponse({ status: 201, description: 'Booking confirmed successfully' })
  async bookSlot(@Req() req, @Body() bookingData: BookSlotDto) {
    return this.vehicleBookingService.bookSlot(req.user.userId, bookingData);
  }
}
