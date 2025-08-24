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
import { GarageBookingService } from './services/garage-booking.service';
import { GaragePaymentService } from './services/garage-payment.service';
import { GarageInvoiceService } from './services/garage-invoice.service';
import { memoryStorage } from 'multer';
import { ManualSlotDto } from './dto/manual-slot.dto';
import { ScheduleDto, SetWeeklyPatternDto } from './dto/schedule.dto';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';
import { SlotModificationDto } from './dto/slot-modification.dto';
import { ModifySlotTimeDto } from './dto/modify-slot-time.dto';

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

  @ApiOperation({ summary: 'Get garage schedule' })
  @Get('schedule')
  async getSchedule(@Req() req) {
    return this.garageScheduleService.getSchedule(req.user.userId);
  }

  @ApiOperation({ summary: 'Set garage schedule' })
  @Post('schedule')
  async setSchedule(@Req() req, @Body() dto: ScheduleDto) {
    return this.garageScheduleService.setSchedule(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Set weekly pattern (legacy support)' })
  @Post('schedule/weekly')
  async setWeeklyPattern(@Req() req, @Body() dto: SetWeeklyPatternDto) {
    return this.garageScheduleService.setWeeklyPattern(req.user.userId, dto);
  }

  // NEW: View available slots dynamically
  @ApiOperation({ summary: 'View available slots for date (dynamic)' })
  @Get('schedule/slots/view')
  async viewAvailableSlots(@Req() req, @Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('Date parameter is required');
    }
    return this.garageScheduleService.viewAvailableSlots(req.user.userId, date);
  }

  // NEW: Create specific slot
  @ApiOperation({ summary: 'Create specific slot for date and time' })
  @Post('schedule/slots')
  async createSlot(
    @Req() req,
    @Body() dto: { date: string; start_time: string },
  ) {
    return this.garageScheduleService.createSlot(
      req.user.userId,
      dto.date,
      dto.start_time,
    );
  }

  // Get existing available slots for a date
  @ApiOperation({ summary: 'Get existing available slots for date' })
  @Get('schedule/slots')
  async getAvailableSlots(@Req() req, @Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('Date parameter is required');
    }
    return this.garageScheduleService.getAvailableSlots(req.user.userId, date);
  }

  @ApiOperation({ summary: 'Block a time slot' })
  @Patch('schedule/slots/:id/block')
  async blockSlot(@Req() req, @Param('id') slotId: string) {
    return this.garageScheduleService.blockSlot(req.user.userId, slotId);
  }

  @ApiOperation({ summary: 'Unblock a time slot' })
  @Patch('schedule/slots/:id/unblock')
  async unblockSlot(@Req() req, @Param('id') slotId: string) {
    return this.garageScheduleService.unblockSlot(req.user.userId, slotId);
  }

  @ApiOperation({ summary: 'Add manual slots for date' })
  @Post('schedule/slots/manual')
  async setManualSlotsForDate(@Req() req, @Body() dto: ManualSlotDto) {
    return this.garageScheduleService.setManualSlotsForDate(
      req.user.userId,
      dto,
    );
  }

  @ApiOperation({ summary: 'Remove all slots for date' })
  @Delete('schedule/slots/manual')
  async removeAllSlotsForDate(@Req() req, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date is required');
    return this.garageScheduleService.removeAllSlotsForDate(
      req.user.userId,
      date,
    );
  }

  @ApiOperation({ summary: 'Delete specific slot' })
  @Delete('schedule/slots/:id')
  async deleteSlot(@Req() req, @Param('id') slotId: string) {
    return this.garageScheduleService.deleteSlotById(req.user.userId, slotId);
  }

  // ✅ NEW: Get calendar data for month (holidays only)
  @ApiOperation({
    summary: 'Get calendar data for month',
    description:
      'Returns all holidays for a specific month. Frontend can use this to render week/month views and mark holidays appropriately.',
  })
  @Get('schedule/calendar')
  async getCalendarData(
    @Req() req,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    if (!year || !month) {
      throw new BadRequestException('Year and month parameters are required');
    }

    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    if (isNaN(yearNum) || isNaN(monthNum)) {
      throw new BadRequestException('Invalid year or month format');
    }

    if (monthNum < 1 || monthNum > 12) {
      throw new BadRequestException('Month must be between 1 and 12');
    }

    return this.garageScheduleService.getCalendarData(
      req.user.userId,
      yearNum,
      monthNum,
    );
  }

  // NEW: Modify slots (block/unblock)
  @Post('schedule/modify')
  @ApiOperation({ summary: 'Modify slots (block/unblock)' })
  async modifySlots(@Req() req, @Body() dto: SlotModificationDto) {
    return this.garageScheduleService.modifySlots(req.user.userId, dto);
  }

  @Patch('schedule/slots/time')
  @ApiOperation({
    summary: 'Modify slot time with overlap control',
    description: `
      Modify the start/end time of a specific slot.
      
      **Overlap Behavior:**
      - If overlap=false (default): Rejects modification if it would affect existing slots
      - If overlap=true: Allows modification and deletes overlapping slots
      - Booked slots are always protected (no override allowed)
      
      **Example Responses:**
      - Success: Slot modified successfully
      - Warning: Shows affected slots when overlap=false
      - Error: Cannot overlap with booked slots
    `,
  })
  async modifySlotTime(@Req() req, @Body() dto: ModifySlotTimeDto) {
    return this.garageScheduleService.modifySlotTime(req.user.userId, dto);
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
