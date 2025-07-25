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
  Delete,
  BadRequestException,
  Query,
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
import { CreateCalendarDto } from './dto/create-calendar.dto';
import { ManualSlotDto } from './dto/manual-slot.dto';

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
    return this.garageProfileService.updateProfile(
      req.user.userId,
      dto,
      avatar,
    );
  }

  // ==================== PRICING MANAGEMENT ====================

  @ApiOperation({ summary: 'Get all services' })
  @Get('services')
  async getServices(@Req() req) {
    return this.garagePricingService.getServices(req.user.userId);
  }

  @ApiOperation({ summary: 'Delete service' })
  @Delete('services/:id')
  async deleteService(@Req() req, @Param('id') id: string) {
    return this.garagePricingService.deleteService(req.user.userId, id);
  }

  @ApiOperation({
    summary: 'Upsert MOT, Retest, and Additional services in one request',
  })
  @Post('service-price')
  async upsertServicePrice(@Req() req, @Body() body) {
    return this.garagePricingService.upsertServicePrice(req.user.userId, body);
  }

  // ==================== AVAILABILITY MANAGEMENT ====================

  @Get('schedules')
  async getSchedules(@Req() req) {
    return this.garageScheduleService.getSchedules(req.user.userId);
  }

  @Post('schedules')
  async createSchedule(@Req() req, @Body() dtos: CreateScheduleDto[]) {
    return this.garageScheduleService.createSchedule(req.user.userId, dtos);
  }

  @Patch('schedules/:id')
  async updateSchedule(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.garageScheduleService.updateSchedule(req.user.userId, id, dto);
  }

  @Get('calendar')
  async getCalendar(@Req() req) {
    return this.garageScheduleService.getCalendar(req.user.userId);
  }

  @Post('calendar')
  async upsertCalendarEvent(@Req() req, @Body() dto: CreateCalendarDto) {
    return this.garageScheduleService.upsertCalendarEvent(req.user.userId, dto);
  }

  @Delete('calendar/all')
  async deleteAllCalendarEvents(@Req() req) {
    console.log(req.user.userId);
    return this.garageScheduleService.deleteAllCalendarEvents(req.user.userId);
  }

  @Delete('calendar/:id')
  async deleteCalendarEvent(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.deleteCalendarEvent(req.user.userId, id);
  }

  @Post('calendar/bulk')
  async bulkSetCalendar(
    @Req() req,
    @Body()
    body: {
      start_date: string;
      end_date: string;
      days: {
        day_of_week: number;
        type: string;
        start_time?: string;
        end_time?: string;
      }[];
      description?: string;
    },
  ) {
    return this.garageScheduleService.bulkSetCalendar(req.user.userId, body);
  }

  @Get('availability')
  async getMonthAvailability(
    @Req() req,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    if (!month || !year) {
      throw new BadRequestException('month and year are required');
    }
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    if (isNaN(monthNum) || isNaN(yearNum)) {
      throw new BadRequestException('month and year must be numbers');
    }
    return this.garageScheduleService.getMonthWeeksStatus(
      req.user.userId,
      yearNum,
      monthNum,
    );
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

  // ==================== SLOT MANAGEMENT ====================

  @Get('slots')
  async getSlotsForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.getSlotsForDate(req.user.userId, date);
  }

  @Patch('slots/:id/block')
  async blockSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.setSlotBlockedStatus(
      req.user.userId,
      id,
      true,
    );
  }

  @Patch('slots/:id/unblock')
  async unblockSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.setSlotBlockedStatus(
      req.user.userId,
      id,
      false,
    );
  }

  @Patch('slots/:id')
  async updateSlot(
    @Req() req,
    @Param('id') id: string,
    @Body() body: { start_time: string; end_time: string },
  ) {
    return this.garageScheduleService.updateSlotById(
      req.user.userId,
      id,
      body.start_time,
      body.end_time,
    );
  }

  @Patch('slot-duration/:dayOfWeek')
  async updateSlotDuration(
    @Req() req,
    @Param('dayOfWeek') dayOfWeek: string,
    @Body() body: { slotDuration: number },
  ) {
    const day = parseInt(dayOfWeek, 10);
    if (isNaN(day) || day < 0 || day > 6)
      throw new BadRequestException('Invalid dayOfWeek');
    if (!body.slotDuration || body.slotDuration < 1)
      throw new BadRequestException('Invalid slotDuration');
    return this.garageScheduleService.updateSlotDuration(
      req.user.userId,
      day,
      body.slotDuration,
    );
  }

  @Post('slots/manual')
  async setManualSlotsForDate(@Req() req, @Body() dto: ManualSlotDto) {
    return this.garageScheduleService.setManualSlotsForDate(
      req.user.userId,
      dto,
    );
  }

  @Delete('slots/manual')
  async removeAllSlotsForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.removeAllSlotsForDate(
      req.user.userId,
      date,
    );
  }

  @Delete('slots/:id')
  async deleteSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.deleteSlotById(req.user.userId, id);
  }
}
