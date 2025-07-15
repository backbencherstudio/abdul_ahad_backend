import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  Param,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guard/role/roles.guard';
import { Roles } from '../../../common/guard/role/roles.decorator';
import { Role } from '../../../common/guard/role/role.enum';
import { GarageProfileService } from './services/garage-profile.service';
import { GaragePricingService } from './services/garage-pricing.service';
import { GarageScheduleService } from './services/garage-schedule.service';

import { UpdateGarageProfileDto } from './dto/update-garage-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { GarageBookingService } from './services/garage-booking.service';
import { GaragePaymentService } from './services/garage-payment.service';
import { GarageInvoiceService } from './services/garage-invoice.service';
import { memoryStorage } from 'multer';

@ApiTags('Garage Dashboard')
@Controller('garage-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.GARAGE)
export class GarageDashboardController {
  constructor(
    private readonly garageProfileService: GarageProfileService,
    private readonly garagePricingService: GaragePricingService,
    private readonly garageScheduleService: GarageScheduleService,
    private readonly garageBookingService: GarageBookingService,
    private readonly garagePaymentService: GaragePaymentService,
    private readonly garageInvoiceService: GarageInvoiceService,
  ) {}

  // ==================== PROFILE MANAGEMENT ====================

  @ApiOperation({ summary: 'Get garage profile' })
  @Get('profile')
  async getProfile(@Req() req) {
    return this.garageProfileService.getProfile(req.user.userId);
  }

  @ApiOperation({ summary: 'Update garage profile' })
  @Patch('profile')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        garage_name: { type: 'string' },
        address: { type: 'string' },
        zip_code: { type: 'string' },
        vts_number: { type: 'string' },
        primary_contact: { type: 'string' },
        phone_number: { type: 'string' },
        avatar: { type: 'string', format: 'binary' },
      },
    },
  })
  async updateProfile(
    @Req() req,
    @Body() dto: UpdateGarageProfileDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    return this.garageProfileService.updateProfile(req.user.userId, dto, avatar);
  }

  // ==================== PRICING MANAGEMENT ====================

  @ApiOperation({ summary: 'Get all services' })
  @Get('services')
  async getServices(@Req() req) {
    return this.garagePricingService.getServices(req.user.userId);
  }

  @ApiOperation({ summary: 'Create new service' })
  @Post('services')
  async createService(@Req() req, @Body() dto: CreateServiceDto) {
    return this.garagePricingService.createService(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Update service' })
  @Patch('services/:id')
  async updateService(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.garagePricingService.updateService(req.user.userId, id, dto);
  }

  // ==================== AVAILABILITY MANAGEMENT ====================

  @ApiOperation({ summary: 'Get weekly schedule' })
  @Get('schedules')
  async getSchedules(@Req() req) {
    return this.garageScheduleService.getSchedules(req.user.userId);
  }

  @ApiOperation({ summary: 'Create/Update weekly schedule' })
  @Post('schedules')
  async createSchedule(@Req() req, @Body() dto: CreateScheduleDto) {
    return this.garageScheduleService.createSchedule(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Update schedule' })
  @Patch('schedules/:id')
  async updateSchedule(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.garageScheduleService.updateSchedule(req.user.userId, id, dto);
  }

  // ==================== BOOKING MANAGEMENT ====================

  @ApiOperation({ summary: 'Get all bookings' })
  @Get('bookings')
  async getBookings(@Req() req) {
    return this.garageBookingService.getBookings(req.user.userId);
  }

  @ApiOperation({ summary: 'Get booking by ID' })
  @Get('bookings/:id')
  async getBooking(@Req() req, @Param('id') id: string) {
    return this.garageBookingService.getBooking(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Update booking status' })
  @Patch('bookings/:id/status')
  async updateBookingStatus(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: { status: string },
  ) {
    return this.garageBookingService.updateBookingStatus(
      req.user.userId,
      id,
      dto.status,
    );
  }

  // ==================== PAYMENT MANAGEMENT ====================

  @ApiOperation({ summary: 'Get all payments' })
  @Get('payments')
  async getPayments(@Req() req) {
    return this.garagePaymentService.getPayments(req.user.userId);
  }

  @ApiOperation({ summary: 'Get payment by ID' })
  @Get('payments/:id')
  async getPayment(@Req() req, @Param('id') id: string) {
    return this.garagePaymentService.getPayment(req.user.userId, id);
  }

  // ==================== INVOICE MANAGEMENT ====================

  @ApiOperation({ summary: 'Get all invoices' })
  @Get('invoices')
  async getInvoices(@Req() req) {
    return this.garageInvoiceService.getInvoices(req.user.userId);
  }

  @ApiOperation({ summary: 'Get invoice by ID' })
  @Get('invoices/:id')
  async getInvoice(@Req() req, @Param('id') id: string) {
    return this.garageInvoiceService.getInvoice(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Download invoice PDF' })
  @Post('invoices/:id/download')
  async downloadInvoice(@Req() req, @Param('id') id: string) {
    return this.garageInvoiceService.downloadInvoice(req.user.userId, id);
  }
}
