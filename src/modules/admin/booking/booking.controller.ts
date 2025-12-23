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
import { BookingService } from './booking.service';

@ApiTags('Admin Booking Management')
@Controller('admin/booking')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @ApiOperation({ summary: 'Get all bookings (admin view)' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Booking' })
  async getBookings(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      throw new BadRequestException('Invalid page or limit parameters');
    }

    return this.bookingService.getBookings(
      pageNum,
      limitNum,
      status,
      startDate,
      endDate,
    );
  }

  @ApiOperation({ summary: 'Get booking details by ID' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Booking' })
  async getBooking(@Param('id') id: string) {
    return this.bookingService.getBookingById(id);
  }

  @ApiOperation({ summary: 'Update booking status' })
  @Patch(':id/status')
  @CheckAbilities({ action: Action.Update, subject: 'Booking' })
  async updateBookingStatus(
    @Param('id') id: string,
    @Query('status') status: string,
  ) {
    return this.bookingService.updateBookingStatus(id, status);
  }

  @ApiOperation({ summary: 'Cancel booking' })
  @Patch(':id/cancel')
  @CheckAbilities({ action: Action.Cancel, subject: 'Booking' })
  async cancelBooking(@Param('id') id: string) {
    return this.bookingService.cancelBooking(id);
  }
}
