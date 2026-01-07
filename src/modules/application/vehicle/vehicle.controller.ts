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
import { GetMyBookingsDto, MyBookingsResponseDto } from './dto/my-bookings.dto';
import { GetMotReportsQueryDto } from './dto/mot-reports-query.dto';
import { Request } from 'express';
import { JwtOptionalGuard } from 'src/modules/auth/guards';

@Controller('vehicles')
@ApiTags('Vehicles')
@ApiBearerAuth()
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly vehicleGarageService: VehicleGarageService,
    private readonly vehicleBookingService: VehicleBookingService,
  ) {}
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  async addVehicle(@Req() req, @Body() dto: CreateVehicleDto) {
    return this.vehicleService.addVehicle(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  async listVehicles(@Req() req) {
    return this.vehicleService.getVehiclesByUser(req.user.userId); // FIXED
  }

  @Get('mot-report/:reportId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get complete MOT report details for download/report generation',
    description:
      'Returns comprehensive MOT report with vehicle details, test information, and defects. Ready for PDF generation or detailed report display.',
  })
  @ApiResponse({
    status: 200,
    description: 'Complete MOT report with vehicle and test details',
    schema: {
      example: {
        success: true,
        message: 'MOT report retrieved successfully',
        data: {
          reportId: 'cm4xyz123...',
          vehicle: {
            registration: 'LS51 DMW',
            make: 'FORD',
            model: 'FOCUS',
            colour: 'Silver',
            fuelType: 'Petrol',
            engineCapacity: 1600,
            yearOfManufacture: 2001,
            registrationDate: '2001-01-01',
          },
          motTest: {
            testNumber: '5219 3210 9491',
            testDate: '2023-12-07T00:00:00.000Z',
            expiryDate: '2024-01-06T00:00:00.000Z',
            testResult: 'PASSED',
            registrationAtTimeOfTest: 'LS51 DMW',
            odometer: {
              value: 123456,
              unit: 'mi',
              resultType: 'READ',
            },
            dataSource: 'dvsa',
          },
          defects: {
            total: 0,
            dangerous: 0,
            items: [],
          },
          reportMetadata: {
            generatedAt: '2024-12-02T10:43:00.000Z',
            reportType: 'MOT_TEST_CERTIFICATE',
            isPassed: true,
            hasDefects: false,
            hasDangerousDefects: false,
          },
        },
      },
    },
  })
  async getMotReport(@Param('reportId') reportId: string) {
    return this.vehicleService.getMotReportWithDefects(reportId);
  }

  @Get(':vehicleId/mot-reports')
  @Roles(Role.DRIVER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get MOT reports for vehicle with field selection',
    description:
      'Enhanced endpoint with optional field selection, filtering, and pagination. Use query parameters to specify which fields you need.',
  })
  @ApiResponse({
    status: 200,
    description: 'MOT reports with optional field filtering',
    schema: {
      example: {
        registration: 'GF57XWD',
        make: 'FORD',
        model: 'FOCUS',
        motTests: [
          {
            motTestNumber: '451691735331',
            testResult: 'PASSED',
            completedDate: '2024-11-01T12:29:45.000Z',
          },
        ],
        query_info: {
          fields_requested: 'registration,make,model,test_number,status',
          include_defects: true,
          limit: 10,
          page: 1,
          full_response: false,
          total_reports: 1,
        },
      },
    },
  })
  async getMotReports(
    @Req() req,
    @Param('vehicleId') vehicleId: string,
    @Query() query: GetMotReportsQueryDto,
  ) {
    return this.vehicleService.getCompleteMotHistory(
      vehicleId,
      req.user.userId,
      query,
    );
  }

  @Patch(':vehicleId/mot-reports/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  @ApiOperation({
    summary: 'Refresh MOT history from DVLA',
    description:
      'Fetches the latest MOT history from DVLA and updates the local database with any new records. Duplicate records are skipped.',
  })
  @ApiResponse({
    status: 200,
    description: 'MOT history refreshed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Successfully added 2 new MOT records',
        },
        data: {
          type: 'object',
          properties: {
            new_records: { type: 'number', example: 2 },
            latest_expiry: {
              type: 'string',
              example: '2025-01-01T00:00:00.000Z',
            },
          },
        },
      },
    },
  })
  async refreshMotHistory(@Req() req, @Param('vehicleId') vehicleId: string) {
    return this.vehicleService.refreshMotHistory(req.user.userId, vehicleId);
  }

  @Get('my-bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  @ApiOperation({
    summary:
      'Get all bookings for the logged-in driver (with filters, search, and pagination)',
    description: 'Returns bookings filtered by status, search, and paginated.',
  })
  @ApiResponse({ status: 200, type: MyBookingsResponseDto })
  async getMyBookings(@Req() req: Request, @Query() query: GetMyBookingsDto) {
    return this.vehicleBookingService.getMyBookings(req.user?.userId, query);
  }

  // --------------------------------------------- New Added BY Najim ---------------------------------------------
  // IMPORTANT: These specific routes MUST come before dynamic :id routes to avoid route conflicts

  @Get('search-garages')
  @UseGuards(JwtOptionalGuard)
  @ApiOperation({
    summary:
      'Search for garages by vehicle registration and postcode (optional auth)',
    description:
      'Returns a list of active garages. If authenticated, creates vehicle record if needed.',
  })
  @ApiResponse({ status: 200, description: 'List of garages and vehicle info' })
  getGarages(@Query() query: SearchGarageDto, @Req() req: Request) {
    return this.vehicleBookingService.getGarages(
      query,
      req?.user?.userId ?? null,
    );
  }

  @Get('garages/:garageId/services')
  @UseGuards(JwtOptionalGuard)
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
  @UseGuards(JwtOptionalGuard)
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

  // --------------------------------------------- End New Routes ---------------------------------------------

  @Post('search-garages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary:
      'Search for garages by vehicle registration and postcode (authenticated)',
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

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getVehicle(@Req() req, @Param('id') id: string) {
    return this.vehicleService.getVehicleById(req.user.id, id); // FIXED
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteVehicle(@Req() req, @Param('id') id: string) {
    return this.vehicleService.deleteVehicle(req.user.userId, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async updateVehicle(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicleService.updateVehicle(req.user.userId, id, dto);
  }

  @Post('book-slot')
  @UseGuards(JwtAuthGuard, RolesGuard)
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
