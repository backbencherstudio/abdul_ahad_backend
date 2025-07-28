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
import { GarageBookingService } from './services/garage-booking.service';
import { GaragePaymentService } from './services/garage-payment.service';
import { GarageInvoiceService } from './services/garage-invoice.service';
import { memoryStorage } from 'multer';
import { ManualSlotDto } from './dto/manual-slot.dto';
import { ScheduleDto, SetWeeklyPatternDto } from './dto/schedule.dto';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';

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
    description: `
      MOT and Retest services require both name and price.
      Additional services only require name (no price allowed).
      
      Examples:
      - Set all prices: { "mot": { "name": "MOT Test", "price": 54.85 }, "retest": { "name": "MOT Retest", "price": 20.00 }, "additionals": [{ "name": "Tyre Change" }] }
      - Update only additionals: { "additionals": [{ "id": "existing-id", "name": "Updated Service" }] }
    `,
  })
  @Post('service-price')
  async upsertServicePrice(@Req() req, @Body() body: UpsertServicePriceDto) {
    return this.garagePricingService.upsertServicePrice(req.user.userId, body);
  }

  // ==================== SCHEDULE MANAGEMENT ====================

  @ApiOperation({ summary: 'Get schedule for specific date' })
  @Get('schedule')
  async getScheduleForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.getScheduleForDate(req.user.userId, date);
  }

  @ApiOperation({ summary: 'Get week schedule' })
  @Get('schedule/week')
  async getWeekSchedule(@Req() req, @Query('startDate') startDate: string) {
    if (!startDate) throw new BadRequestException('startDate is required');
    return this.garageScheduleService.getWeekSchedule(
      req.user.userId,
      startDate,
    );
  }

  @ApiOperation({ summary: 'Get month schedule' })
  @Get('schedule/month')
  async getMonthSchedule(
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
    return this.garageScheduleService.getMonthSchedule(
      req.user.userId,
      yearNum,
      monthNum,
    );
  }

  @ApiOperation({ summary: 'Set schedule for specific date' })
  @Post('schedule')
  async setScheduleForDate(@Req() req, @Body() dto: ScheduleDto) {
    return this.garageScheduleService.setScheduleForDate(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Set weekly pattern' })
  @Post('schedule/weekly')
  async setWeeklyPattern(@Req() req, @Body() dto: SetWeeklyPatternDto) {
    return this.garageScheduleService.setWeeklyPattern(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Delete schedule for specific date' })
  @Delete('schedule')
  async deleteScheduleForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.deleteScheduleForDate(
      req.user.userId,
      date,
    );
  }

  @ApiOperation({ summary: 'Complete schedule reset (delete everything)' })
  @Delete('schedule/reset')
  async completeReset(@Req() req) {
    return this.garageScheduleService.completeReset(req.user.userId);
  }

  @ApiOperation({ summary: 'Get user reset state' })
  @Get('schedule/reset-state')
  async getResetState(@Req() req) {
    return this.garageScheduleService.getResetState(req.user.userId);
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

  @ApiOperation({ summary: 'Get slots for specific date' })
  @Get('slots')
  async getSlotsForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.getSlotsForDate(req.user.userId, date);
  }

  @ApiOperation({ summary: 'Block a slot' })
  @Patch('slots/:id/block')
  async blockSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.setSlotBlockedStatus(
      req.user.userId,
      id,
      true,
    );
  }

  @ApiOperation({ summary: 'Unblock a slot' })
  @Patch('slots/:id/unblock')
  async unblockSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.setSlotBlockedStatus(
      req.user.userId,
      id,
      false,
    );
  }

  @ApiOperation({ summary: 'Update slot time' })
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

  @ApiOperation({ summary: 'Add manual slots for date' })
  @Post('slots/manual')
  async setManualSlotsForDate(@Req() req, @Body() dto: ManualSlotDto) {
    return this.garageScheduleService.setManualSlotsForDate(
      req.user.userId,
      dto,
    );
  }

  @ApiOperation({ summary: 'Remove all slots for date' })
  @Delete('slots/manual')
  async removeAllSlotsForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.removeAllSlotsForDate(
      req.user.userId,
      date,
    );
  }

  @ApiOperation({ summary: 'Delete specific slot' })
  @Delete('slots/:id')
  async deleteSlot(@Req() req, @Param('id') id: string) {
    return this.garageScheduleService.deleteSlotById(req.user.userId, id);
  }
}
