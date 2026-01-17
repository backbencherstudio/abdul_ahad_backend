import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  GetBookingsDto,
  BookingStatusFilter,
  DateFilter,
} from '../dto/get-bookings.dto';
import { OrderStatus, Prisma } from '@prisma/client';
import { NotificationService } from '../../notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';
import { RescheduleBookingDto } from '../dto/schedule.dto';

@Injectable()
export class GarageBookingService {
  private readonly logger = new Logger(GarageBookingService.name);

  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async getBookings(userId: string, query: GetBookingsDto) {
    const {
      search,
      status,
      page = 1,
      limit = 10,
      date_filter = DateFilter.ALL,
    } = query;

    // Build where clause
    const where: Prisma.OrderWhereInput = {
      garage_id: userId,
    };

    // Apply status filter
    if (status && status !== BookingStatusFilter.ALL) {
      where.status = status as OrderStatus;
    }

    // Apply search filter
    if (search && search.trim()) {
      where.OR = [
        {
          vehicle: {
            registration_number: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          driver: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            make: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            model: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            color: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            fuel_type: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          driver: {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    // Apply date filter
    if (date_filter && date_filter !== DateFilter.ALL) {
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      const getMonday = (d: Date) => {
        const dCopy = new Date(d);
        const day = dCopy.getDay();
        const diff = dCopy.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        dCopy.setDate(diff);
        dCopy.setHours(0, 0, 0, 0);
        return dCopy;
      };

      const mondayThisWeek = getMonday(new Date());
      const sundayThisWeek = new Date(mondayThisWeek);
      sundayThisWeek.setDate(sundayThisWeek.getDate() + 6);
      sundayThisWeek.setHours(23, 59, 59, 999);

      const mondayNextWeek = new Date(mondayThisWeek);
      mondayNextWeek.setDate(mondayNextWeek.getDate() + 7);
      const sundayNextWeek = new Date(mondayNextWeek);
      sundayNextWeek.setDate(sundayNextWeek.getDate() + 6);
      sundayNextWeek.setHours(23, 59, 59, 999);

      if (date_filter === DateFilter.TODAY) {
        where.order_date = {
          gte: startOfDay,
          lte: endOfDay,
        };
      } else if (date_filter === DateFilter.TOMORROW) {
        const tomorrowStart = new Date(startOfDay);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        const tomorrowEnd = new Date(endOfDay);
        tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

        where.order_date = {
          gte: tomorrowStart,
          lte: tomorrowEnd,
        };
      } else if (date_filter === DateFilter.THIS_WEEK) {
        where.order_date = {
          gte: mondayThisWeek,
          lte: sundayThisWeek,
        };
      } else if (date_filter === DateFilter.NEXT_WEEK) {
        where.order_date = {
          gte: mondayNextWeek,
          lte: sundayNextWeek,
        };
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.prisma.order.count({ where });

    // Get bookings with relations
    const bookings = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        created_at: true,
        order_date: true,
        status: true,
        total_amount: true,
        garage_id: true,
        vehicle: {
          select: {
            id: true,
            registration_number: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
          },
        },
        slot: {
          select: {
            id: true,
            start_datetime: true,
            end_datetime: true,
          },
        },
      },
      orderBy: {
        ...(date_filter !== DateFilter.ALL ? { order_date: 'asc' } : {}),
      },
      skip,
      take: limit,
    });

    return {
      success: true,
      message: 'Bookings retrieved successfully',
      data: bookings,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.order.findFirst({
      where: {
        id: bookingId,
        garage_id: userId,
      },
      select: {
        id: true,
        created_at: true,
        order_date: true,
        status: true,
        total_amount: true,
        garage_id: true,
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            address: true,
            zip_code: true,
          },
        },
        vehicle: {
          select: {
            id: true,
            registration_number: true,
            make: true,
            model: true,
            color: true,
            fuel_type: true,
            year_of_manufacture: true,
            mot_expiry_date: true,
          },
        },
        slot: {
          select: {
            id: true,
            start_datetime: true,
            end_datetime: true,
          },
        },
        items: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                type: true,
                price: true,
              },
            },
          },
        },
        // payment_transactions: {
        //   select: {
        //     id: true,
        //     amount: true,
        //     currency: true,
        //     status: true,
        //     provider: true,
        //     created_at: true,
        //   },
        // },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return {
      success: true,
      message: 'Booking retrieved successfully',
      data: booking,
    };
  }

  async updateBookingStatus(
    userId: string,
    bookingId: string,
    status: OrderStatus,
  ) {
    const booking = await this.prisma.order.findFirst({
      where: {
        id: bookingId,
        garage_id: userId,
      },
      select: {
        id: true,
        status: true,
        driver_id: true,
        order_date: true,
        slot_id: true,
        garage: {
          select: {
            garage_name: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // ❌ Already rejected → no further update allowed
    if (booking.status === OrderStatus.REJECTED) {
      throw new BadRequestException('Rejected booking cannot be updated');
    }

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      // Update order status
      const order = await tx.order.update({
        where: { id: bookingId },
        data: {
          status,
          ...((status === OrderStatus.REJECTED ||
            status === OrderStatus.CANCELLED) && { slot: null }),
        },
        include: {
          driver: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          vehicle: {
            select: {
              registration_number: true,
            },
          },
        },
      });

      // Only when rejected → free slot
      if (
        (status === OrderStatus.REJECTED || status === OrderStatus.CANCELLED) &&
        booking.slot_id
      ) {
        await tx.timeSlot.update({
          where: { id: booking.slot_id },
          data: {
            order: null,
            is_available: true,
          },
        });
      }

      return order;
    });

    await this.notificationService.create({
      receiver_id: booking.driver_id,
      sender_id: userId,
      type: NotificationType.BOOKING,
      text:
        status === OrderStatus.ACCEPTED
          ? `Your booking with ${booking.garage.garage_name} has been accepted on ${booking.order_date.toISOString().split('T')[0]} at ${booking.order_date.toISOString().split('T')[1]}.`
          : `Your booking with ${booking.garage.garage_name} has been rejected on ${booking.order_date.toISOString().split('T')[0]} at ${booking.order_date.toISOString().split('T')[1]}.`,
      entity_id: booking.id,
    });

    return {
      success: true,
      message: 'Booking status updated successfully',
      data: updatedBooking,
    };
  }

  // Reschedule a booking to a new slot or custom time
  async rescheduleBooking(garageId: string, body: RescheduleBookingDto) {
    const { booking_id, slot_id, date, start_time, end_time, reason } = body;

    if (!booking_id) {
      throw new BadRequestException('booking_id is required');
    }

    if (!slot_id && !(date && start_time && end_time)) {
      throw new BadRequestException(
        'Provide either slot_id or date + start_time + end_time',
      );
    }

    // Fetch booking
    const booking = await this.prisma.order.findFirst({
      where: { id: booking_id, garage_id: garageId },
      select: { id: true, status: true, slot_id: true, driver_id: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    if (
      booking.status === OrderStatus.CANCELLED ||
      booking.status === OrderStatus.REJECTED ||
      booking.status === OrderStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Cannot reschedule a ${booking.status.toLowerCase()} booking`,
      );
    }

    // Prepare target slot descriptor
    let targetSlot: any | null = null;
    let startDateTime: Date | null = null;
    let endDateTime: Date | null = null;

    return await this.prisma.$transaction(async (tx) => {
      // If existing slot id provided: validate availability
      if (slot_id) {
        targetSlot = await tx.timeSlot.findFirst({
          where: {
            id: slot_id,
            garage_id: garageId,
            is_available: true,
            is_blocked: false,
            order_id: null,
          },
        });

        if (!targetSlot)
          throw new ConflictException('Target slot is not available');

        // Prevent past reschedule
        if (new Date(targetSlot.start_datetime) < new Date()) {
          throw new BadRequestException('Cannot reschedule to a past time');
        }

        startDateTime = new Date(targetSlot.start_datetime);
        endDateTime = new Date(targetSlot.end_datetime);
      } else {
        // Create/find a slot from custom date/time
        startDateTime = new Date(`${date}T${start_time}:00`);
        endDateTime = new Date(`${date}T${end_time}:00`);

        // Validate schedule/holiday/break and duration
        await this.validateSlotIsBookableForGarage(
          garageId,
          startDateTime,
          endDateTime,
          tx,
        );

        // Check for an existing DB slot at this time
        targetSlot = await tx.timeSlot.findUnique({
          where: {
            garage_id_start_datetime: {
              garage_id: garageId,
              start_datetime: startDateTime,
            },
          },
        });

        if (targetSlot) {
          if (targetSlot.order_id) {
            throw new ConflictException(
              'This time is already booked by someone else',
            );
          }
          if (targetSlot.is_blocked) {
            throw new BadRequestException('This time is blocked');
          }
          if (!targetSlot.is_available) {
            // conservatively disallow if system marked unavailable
            throw new BadRequestException('This time is not available');
          }
        } else {
          // Create slot shell (available=false until linked)
          targetSlot = await tx.timeSlot.create({
            data: {
              garage_id: garageId,
              start_datetime: startDateTime,
              end_datetime: endDateTime,
              is_available: false,
              is_blocked: false,
              modification_type: 'TIME_MODIFIED',
              modified_by: garageId,
              modification_reason: reason || 'Booking rescheduled',
            },
          });
        }
      }

      // Free previous slot if any
      if (booking.slot_id) {
        await tx.timeSlot.update({
          where: { id: booking.slot_id },
          data: {
            order_id: null,
            is_available: true,
            modification_type: 'TIME_MODIFIED',
            modified_by: garageId,
            modification_reason:
              reason || 'Booking rescheduled - freed previous slot',
          },
        });
      }

      // Assign booking to target slot
      await tx.timeSlot.update({
        where: { id: targetSlot.id },
        data: {
          order_id: booking.id,
          is_available: false,
          modification_type: 'TIME_MODIFIED',
          modified_by: garageId,
          modification_reason:
            reason || 'Booking rescheduled - assigned new slot',
        },
      });

      // Update order's slot reference and order_date
      const updated = await tx.order.update({
        where: { id: booking.id },
        data: {
          slot_id: targetSlot.id,
          order_date: startDateTime!,
        },
        include: {
          slot: true,
        },
      });

      return {
        success: true,
        message: 'Booking rescheduled successfully',
        data: {
          order_id: updated.id,
          slot_id: updated.slot_id,
          new_start: updated.slot?.start_datetime,
          new_end: updated.slot?.end_datetime,
        },
      };
    });
  }

  private async validateSlotIsBookableForGarage(
    garageId: string,
    startDateTime: Date,
    endDateTime: Date,
    tx: any,
  ): Promise<void> {
    const schedule = await tx.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule?.is_active) {
      throw new BadRequestException('Garage schedule not active');
    }

    if (startDateTime < new Date()) {
      throw new BadRequestException('Cannot reschedule to past dates');
    }

    const dayOfWeek = startDateTime.getDay();
    const dailyHours = this.parseDailyHours(schedule.daily_hours);
    const dayConfig = dailyHours?.[dayOfWeek];

    if (dayConfig?.is_closed) {
      throw new BadRequestException('Garage closed on this day');
    }

    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions || '[]');

    this.checkHoliday(restrictions, startDateTime, dayOfWeek);
    this.checkBreakTime(restrictions, startDateTime, endDateTime, dayOfWeek);
    this.checkOperatingHours(
      schedule,
      startDateTime,
      endDateTime,
      dayOfWeek,
      dayConfig,
    );
    this.checkSlotDuration(startDateTime, endDateTime);
  }

  private parseDailyHours(dailyHours: any): any {
    if (!dailyHours) return null;
    return typeof dailyHours === 'string' ? JSON.parse(dailyHours) : dailyHours;
  }

  private checkHoliday(
    restrictions: any[],
    startDateTime: Date,
    dayOfWeek: number,
  ): void {
    const dateStr = startDateTime.toISOString().split('T')[0];
    const month = startDateTime.getMonth() + 1;
    const day = startDateTime.getDate();

    const isHoliday = restrictions.some((r) => {
      if (r.type !== 'HOLIDAY') return false;
      if (r.date === dateStr) return true;
      if (r.month !== undefined && r.day !== undefined) {
        if (r.month === month && r.day === day) return true;
      }
      return this.matchesDayOfWeek(r.day_of_week, dayOfWeek);
    });

    if (isHoliday) {
      throw new BadRequestException('Cannot reschedule on holidays');
    }
  }

  private checkBreakTime(
    restrictions: any[],
    startDateTime: Date,
    endDateTime: Date,
    dayOfWeek: number,
  ): void {
    const startMins = this.parseTimeToMinutes(
      this.formatTime24Hour(startDateTime),
    );
    const endMins = this.parseTimeToMinutes(this.formatTime24Hour(endDateTime));

    for (const r of restrictions) {
      if (
        r.type === 'BREAK' &&
        this.matchesDayOfWeek(r.day_of_week, dayOfWeek)
      ) {
        const breakStart = this.parseTimeToMinutes(r.start_time);
        const breakEnd = this.parseTimeToMinutes(r.end_time);

        if (startMins < breakEnd && endMins > breakStart) {
          throw new BadRequestException(
            `Cannot reschedule during break (${r.start_time}-${r.end_time})`,
          );
        }
      }
    }
  }

  private checkOperatingHours(
    schedule: any,
    startDateTime: Date,
    endDateTime: Date,
    dayOfWeek: number,
    dayConfig: any,
  ): void {
    const startMins = this.parseTimeToMinutes(
      this.formatTime24Hour(startDateTime),
    );
    const endMins = this.parseTimeToMinutes(this.formatTime24Hour(endDateTime));

    let intervals: { start: number; end: number }[] = [];

    if (dayConfig?.intervals?.length) {
      intervals = dayConfig.intervals.map((i: any) => ({
        start: this.parseTimeToMinutes(i.start_time),
        end: this.parseTimeToMinutes(i.end_time),
      }));
    } else {
      intervals = [
        {
          start: this.parseTimeToMinutes(schedule.start_time),
          end: this.parseTimeToMinutes(schedule.end_time),
        },
      ];
    }

    const valid = intervals.some(
      (i) => startMins >= i.start && endMins <= i.end,
    );

    if (!valid) {
      const times = intervals
        .map(
          (i) =>
            `${this.formatMinutesToTime(i.start)}-${this.formatMinutesToTime(i.end)}`,
        )
        .join(', ');
      throw new BadRequestException(`Must be within hours: ${times}`);
    }
  }

  private checkSlotDuration(startDateTime: Date, endDateTime: Date): void {
    const mins = (endDateTime.getTime() - startDateTime.getTime()) / 60000;
    if (mins < 15 || mins > 480) {
      throw new BadRequestException('Duration must be 15min-8hrs');
    }
  }

  private matchesDayOfWeek(restrictionDay: any, dayOfWeek: number): boolean {
    if (restrictionDay === undefined || restrictionDay === null) return false;
    if (Array.isArray(restrictionDay))
      return restrictionDay.includes(dayOfWeek);
    const day =
      typeof restrictionDay === 'string'
        ? parseInt(restrictionDay)
        : restrictionDay;
    return day === dayOfWeek;
  }

  private formatTime24Hour(date: Date): string {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private formatMinutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
