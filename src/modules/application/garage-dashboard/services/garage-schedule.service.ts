import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  ScheduleDto,
  SetWeeklyPatternDto,
  RestrictionDto,
} from '../dto/schedule.dto';
import { ManualSlotDto } from '../dto/manual-slot.dto';

@Injectable()
export class GarageScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  // Get schedule for garage
  async getSchedule(garageId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule) {
      return {
        success: true,
        data: null,
        message: 'No schedule configured',
      };
    }

    return {
      success: true,
      data: schedule,
    };
  }

  // Create or update schedule (FIXED: No auto-generation)
  async setSchedule(garageId: string, dto: ScheduleDto) {
    // ✅ FIXED: Enhanced 24-hour format validation
    if (
      !this.isValidTimeFormat(dto.start_time) ||
      !this.isValidTimeFormat(dto.end_time)
    ) {
      throw new BadRequestException(
        'Invalid time format. Use 24-hour HH:mm format (e.g., 08:00, 18:00).',
      );
    }

    // Validate start time is before end time
    if (!this.isStartBeforeEnd(dto.start_time, dto.end_time)) {
      throw new BadRequestException('Start time must be before end time.');
    }

    // Validate slot duration
    if (dto.slot_duration < 15 || dto.slot_duration > 480) {
      throw new BadRequestException(
        'Slot duration must be between 15 and 480 minutes.',
      );
    }

    // ✅ FIXED: Validate restrictions have valid 24-hour times
    if (dto.restrictions) {
      for (const restriction of dto.restrictions) {
        if (restriction.type === 'BREAK') {
          if (
            restriction.start_time &&
            !this.isValidTimeFormat(restriction.start_time)
          ) {
            throw new BadRequestException(
              `Invalid break start time: ${restriction.start_time}. Use 24-hour HH:mm format.`,
            );
          }
          if (
            restriction.end_time &&
            !this.isValidTimeFormat(restriction.end_time)
          ) {
            throw new BadRequestException(
              `Invalid break end time: ${restriction.end_time}. Use 24-hour HH:mm format.`,
            );
          }
          if (
            restriction.start_time &&
            restriction.end_time &&
            !this.isStartBeforeEnd(restriction.start_time, restriction.end_time)
          ) {
            throw new BadRequestException(
              `Break start time must be before end time: ${restriction.start_time} - ${restriction.end_time}`,
            );
          }
        }
      }
    }

    // Convert restrictions to JSON for Prisma
    const restrictionsJson = dto.restrictions
      ? JSON.parse(JSON.stringify(dto.restrictions))
      : [];

    const schedule = await this.prisma.schedule.upsert({
      where: { garage_id: garageId },
      update: {
        start_time: dto.start_time,
        end_time: dto.end_time,
        slot_duration: dto.slot_duration,
        restrictions: restrictionsJson,
        is_active: dto.is_active ?? true,
        updated_at: new Date(),
      },
      create: {
        garage_id: garageId,
        start_time: dto.start_time,
        end_time: dto.end_time,
        slot_duration: dto.slot_duration,
        restrictions: restrictionsJson,
        is_active: dto.is_active ?? true,
      },
    });

    // ✅ FIXED: NO auto-generation! Only create schedule
    return {
      success: true,
      message: 'Schedule updated successfully',
      data: schedule,
    };
  }

  // Set weekly pattern (legacy support)
  async setWeeklyPattern(garageId: string, dto: SetWeeklyPatternDto) {
    // Convert weekly pattern to new schedule format
    const restrictions: RestrictionDto[] = dto.pattern
      .filter((day) => day.type === 'HOLIDAY' || day.type === 'CLOSED')
      .map((day) => ({
        type: 'HOLIDAY' as const,
        is_recurring: true,
        day_of_week: day.day_of_week,
        description: day.description || `${day.type} day`,
      }));

    // Get the most common open hours
    const openDays = dto.pattern.filter((day) => day.type === 'OPEN');
    if (openDays.length === 0) {
      throw new BadRequestException('At least one open day is required.');
    }

    // Use the first open day's hours as default
    const defaultHours = openDays[0];

    const scheduleDto: ScheduleDto = {
      start_time: defaultHours.start_time!,
      end_time: defaultHours.end_time!,
      slot_duration: defaultHours.slot_duration || 60,
      restrictions,
    };

    return this.setSchedule(garageId, scheduleDto);
  }

  // ✅ FIXED: View available slots with clean response structure
  async viewAvailableSlots(garageId: string, date: string) {
    // 1. Get schedule configuration
    const schedule = await this.prisma.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule || !schedule.is_active) {
      throw new BadRequestException('No active schedule found.');
    }

    // 2. Parse restrictions
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    // ✅ FIXED: Use local timezone instead of UTC
    const targetDate = new Date(date + 'T00:00:00');

    // 3. Check if day is restricted (holiday)
    if (this.isDayRestricted(restrictions, targetDate)) {
      return {
        success: true,
        data: {
          garage_id: garageId,
          date: date,
          slots: [],
        },
        message: 'Day is closed (holiday)',
      };
    }

    // 4. Generate potential slots for this date (NOT saved to database)
    const potentialSlots = this.generateSlotsForDay(
      schedule.start_time,
      schedule.end_time,
      schedule.slot_duration,
      targetDate,
      garageId,
      restrictions,
    );

    // 5. Check existing slots (created manually or by bookings)
    const existingSlots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    // 6. Merge potential slots with existing slots
    const bookableSlotViews = potentialSlots.map((potentialSlot) => {
      const existingSlot = existingSlots.find(
        (existing) =>
          existing.start_datetime.getTime() ===
          potentialSlot.start_datetime.getTime(),
      );

      if (existingSlot) {
        return {
          type: 'BOOKABLE',
          start_time: this.formatTime24Hour(existingSlot.start_datetime),
          end_time: this.formatTime24Hour(existingSlot.end_datetime),
          start_datetime: existingSlot.start_datetime,
          end_datetime: existingSlot.end_datetime,
          is_available:
            existingSlot.is_available &&
            !existingSlot.is_blocked &&
            !existingSlot.order_id,
          is_blocked: existingSlot.is_blocked,
          order_id: existingSlot.order_id,
          is_existing: true,
        };
      }

      return {
        type: 'BOOKABLE',
        start_time: this.formatTime24Hour(potentialSlot.start_datetime),
        end_time: this.formatTime24Hour(potentialSlot.end_datetime),
        start_datetime: potentialSlot.start_datetime,
        end_datetime: potentialSlot.end_datetime,
        is_available: true,
        is_blocked: false,
        order_id: null,
        is_existing: false,
      };
    });

    // 7. Add break slots for this day
    const dayOfWeek = targetDate.getDay();
    const breakSlots = (restrictions || [])
      .filter(
        (r) =>
          r.type === 'BREAK' &&
          r.day_of_week !== undefined &&
          r.day_of_week === dayOfWeek,
      )
      .map((r) => ({
        type: 'BREAK',
        start_time: r.start_time,
        end_time: r.end_time,
        description: r.description || 'Break',
      }));

    // 8. Combine and sort by start_time
    const allSlots = [...bookableSlotViews, ...breakSlots].sort((a, b) =>
      a.start_time.localeCompare(b.start_time),
    );

    return {
      success: true,
      data: {
        garage_id: garageId,
        date: date,
        slots: allSlots,
      },
      message: `Found ${bookableSlotViews.length} bookable slots and ${breakSlots.length} break(s) for ${date}`,
    };
  }

  // ✅ FIXED: Garage manually creates a specific slot with proper timezone
  async createSlot(garageId: string, date: string, startTime: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule || !schedule.is_active) {
      throw new BadRequestException('No active schedule found.');
    }

    // ✅ FIXED: Validate 24-hour format
    if (!this.isValidTimeFormat(startTime)) {
      throw new BadRequestException(
        'Invalid start time format. Use 24-hour HH:mm format.',
      );
    }

    // ✅ FIXED: Use local timezone instead of UTC
    const targetDate = new Date(date + 'T00:00:00');
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const slotStart = new Date(targetDate);
    slotStart.setHours(startHour, startMinute, 0, 0);

    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + schedule.slot_duration);

    // Check if slot is within operating hours
    const slotStartTime = this.formatTime24Hour(slotStart);
    const slotEndTime = this.formatTime24Hour(slotEnd);

    if (
      slotStartTime < schedule.start_time ||
      slotEndTime > schedule.end_time
    ) {
      throw new BadRequestException('Slot is outside operating hours.');
    }

    // Check restrictions
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    if (this.isDayRestricted(restrictions, targetDate)) {
      throw new BadRequestException('Day is closed (holiday).');
    }

    if (
      this.isTimeInBreak(restrictions, targetDate, slotStartTime, slotEndTime)
    ) {
      throw new BadRequestException('Slot conflicts with break time.');
    }

    // Check if slot already exists
    const existingSlot = await this.prisma.timeSlot.findFirst({
      where: {
        garage_id: garageId,
        start_datetime: slotStart,
      },
    });

    if (existingSlot) {
      throw new BadRequestException('Slot already exists.');
    }

    // Create the slot
    const newSlot = await this.prisma.timeSlot.create({
      data: {
        garage_id: garageId,
        start_datetime: slotStart,
        end_datetime: slotEnd,
        is_available: true,
        is_blocked: false,
      },
    });

    return {
      success: true,
      message: 'Slot created successfully',
      data: newSlot,
    };
  }

  // Get available slots for a date (existing slots only)
  async getAvailableSlots(garageId: string, date: string) {
    // ✅ FIXED: Use local timezone
    const startOfDay = new Date(date + 'T00:00:00');
    const endOfDay = new Date(date + 'T23:59:59');

    const slots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: startOfDay,
          lte: endOfDay,
        },
        is_available: true,
        is_blocked: false,
      },
      orderBy: { start_datetime: 'asc' },
    });

    return {
      success: true,
      data: slots,
    };
  }

  // Block a time slot
  async blockSlot(garageId: string, slotId: string) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found.');
    }

    if (slot.order_id) {
      throw new BadRequestException('Cannot block a booked slot.');
    }

    await this.prisma.timeSlot.update({
      where: { id: slotId },
      data: { is_blocked: true, is_available: false },
    });

    return {
      success: true,
      message: 'Slot blocked successfully',
    };
  }

  // Unblock a time slot
  async unblockSlot(garageId: string, slotId: string) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found.');
    }

    await this.prisma.timeSlot.update({
      where: { id: slotId },
      data: { is_blocked: false, is_available: true },
    });

    return {
      success: true,
      message: 'Slot unblocked successfully',
    };
  }

  // ✅ FIXED: Add manual slots for a date with proper timezone
  async setManualSlotsForDate(garageId: string, dto: ManualSlotDto) {
    // ✅ FIXED: Use local timezone
    const date = new Date(dto.date + 'T00:00:00');
    const slots = dto.slots;

    // Validate all slot times are in 24-hour format
    for (const slot of slots) {
      if (!this.isValidTimeFormat(slot.start_time)) {
        throw new BadRequestException(
          `Invalid start time: ${slot.start_time}. Use 24-hour HH:mm format.`,
        );
      }
      if (!this.isValidTimeFormat(slot.end_time)) {
        throw new BadRequestException(
          `Invalid end time: ${slot.end_time}. Use 24-hour HH:mm format.`,
        );
      }
      if (!this.isStartBeforeEnd(slot.start_time, slot.end_time)) {
        throw new BadRequestException(
          `Start time must be before end time: ${slot.start_time} - ${slot.end_time}`,
        );
      }
    }

    // 1. Fetch existing slots for the date
    const existingSlots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: date,
          lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { start_datetime: 'asc' },
    });

    // 2. If replace mode, delete all existing slots
    if (dto.replace) {
      await this.prisma.timeSlot.deleteMany({
        where: {
          garage_id: garageId,
          start_datetime: {
            gte: date,
            lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      });
    }

    // 3. Validate for overlaps within input slots
    slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 0; i < slots.length - 1; i++) {
      const currentEnd = slots[i].end_time;
      const nextStart = slots[i + 1].start_time;
      if (currentEnd > nextStart) {
        throw new BadRequestException(
          `Slot ${slots[i].start_time}–${slots[i].end_time} overlaps with ${slots[i + 1].start_time}–${slots[i + 1].end_time} in your input`,
        );
      }
    }

    // 4. If not replace mode, validate against existing slots
    if (!dto.replace) {
      for (const newSlot of slots) {
        for (const exist of existingSlots) {
          const existStart = this.formatTime24Hour(exist.start_datetime);
          const existEnd = this.formatTime24Hour(exist.end_datetime);
          if (newSlot.start_time < existEnd && newSlot.end_time > existStart) {
            throw new BadRequestException(
              `Slot ${newSlot.start_time}–${newSlot.end_time} overlaps with existing slot ${existStart}–${existEnd}`,
            );
          }
        }
      }
    }

    // 5. Insert new slots
    const newSlots = [];
    for (const slot of slots) {
      const startDateTime = new Date(date);
      const [startHour, startMinute] = slot.start_time.split(':').map(Number);
      startDateTime.setHours(startHour, startMinute, 0, 0);

      const endDateTime = new Date(date);
      const [endHour, endMinute] = slot.end_time.split(':').map(Number);
      endDateTime.setHours(endHour, endMinute, 0, 0);

      newSlots.push({
        garage_id: garageId,
        start_datetime: startDateTime,
        end_datetime: endDateTime,
        is_available: true,
        is_blocked: false,
      });
    }

    await this.prisma.timeSlot.createMany({
      data: newSlots,
      skipDuplicates: true,
    });

    return {
      success: true,
      message: dto.replace
        ? 'Slots replaced for date'
        : 'Manual slots added for date',
      count: newSlots.length,
    };
  }

  // Remove all slots for a date
  async removeAllSlotsForDate(garageId: string, date: string) {
    // ✅ FIXED: Use local timezone
    const startDate = new Date(date + 'T00:00:00');
    const endDate = new Date(date + 'T23:59:59');

    const result = await this.prisma.timeSlot.deleteMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    return {
      success: true,
      message: 'All slots removed for date',
      count: result.count,
    };
  }

  // Delete specific slot
  async deleteSlotById(garageId: string, slotId: string) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found.');
    }

    await this.prisma.timeSlot.delete({ where: { id: slotId } });

    return {
      success: true,
      message: 'Slot deleted successfully',
    };
  }

  // ✅ FIXED: Enhanced 24-hour format validation
  private isValidTimeFormat(time: string): boolean {
    const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!regex.test(time)) return false;

    const [hours, minutes] = time.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  private isStartBeforeEnd(start: string, end: string): boolean {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return sh < eh || (sh === eh && sm < em);
  }

  // ✅ FIXED: Format time to 24-hour format
  private formatTime24Hour(date: Date): string {
    return date.toTimeString().slice(0, 5); // Returns "HH:mm" format
  }

  private isDayRestricted(restrictions: RestrictionDto[], date: Date): boolean {
    const dayOfWeek = date.getDay();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return restrictions.some((restriction) => {
      if (restriction.type === 'HOLIDAY') {
        if (restriction.is_recurring) {
          if (
            restriction.day_of_week !== undefined &&
            restriction.day_of_week === dayOfWeek
          ) {
            return true;
          }
          if (
            restriction.month !== undefined &&
            restriction.month === month &&
            restriction.day !== undefined &&
            restriction.day === day
          ) {
            return true;
          }
        }
      }
      return false;
    });
  }

  // ✅ FIXED: Enhanced break time checking
  private isTimeInBreak(
    restrictions: RestrictionDto[],
    date: Date,
    startTime: string,
    endTime: string,
  ): boolean {
    const dayOfWeek = date.getDay();

    return restrictions.some((restriction) => {
      if (restriction.type === 'BREAK') {
        // Check if break applies to this day
        if (
          restriction.day_of_week !== undefined &&
          restriction.day_of_week === dayOfWeek
        ) {
          // Check if slot overlaps with break time
          if (restriction.start_time && restriction.end_time) {
            const slotStart = startTime;
            const slotEnd = endTime;
            const breakStart = restriction.start_time;
            const breakEnd = restriction.end_time;

            // Check for overlap
            return slotStart < breakEnd && slotEnd > breakStart;
          }
        }
      }
      return false;
    });
  }

  // ✅ FIXED: Generate slots with proper timezone
  private generateSlotsForDay(
    startTime: string,
    endTime: string,
    slotDuration: number,
    date: Date,
    garageId: string,
    restrictions: RestrictionDto[] = [],
  ) {
    const slots = [];
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);

    let currentTime = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    while (currentTime + slotDuration <= endMinutes) {
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(currentTime / 60), currentTime % 60, 0, 0);

      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

      // Check if slot conflicts with break time
      const slotStartTime = this.formatTime24Hour(slotStart);
      const slotEndTime = this.formatTime24Hour(slotEnd);

      const isInBreak = this.isTimeInBreak(
        restrictions,
        date,
        slotStartTime,
        slotEndTime,
      );

      if (!isInBreak) {
        slots.push({
          garage_id: garageId,
          start_datetime: slotStart,
          end_datetime: slotEnd,
          is_available: true,
          is_blocked: false,
        });
      }

      currentTime += slotDuration;
    }

    return slots;
  }

  // ✅ NEW: Get calendar data for month (holidays only)
  async getCalendarData(garageId: string, year: number, month: number) {
    // 1. Get schedule with restrictions
    const schedule = await this.prisma.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule) {
      return {
        success: true,
        data: {
          year,
          month,
          month_name: this.getMonthName(month),
          holidays: [],
        },
      };
    }

    // 2. Parse restrictions
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    // 3. Generate all holidays for the month
    const holidays = this.generateHolidaysForMonth(restrictions, year, month);

    return {
      success: true,
      data: {
        year,
        month,
        month_name: this.getMonthName(month),
        holidays,
      },
    };
  }

  // ✅ NEW: Generate holidays for a specific month
  private generateHolidaysForMonth(
    restrictions: RestrictionDto[],
    year: number,
    month: number,
  ) {
    const holidays = [];

    // Get all dates in the month
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();

      // Check if this date is a holiday
      const holidayRestriction = restrictions.find(
        (r) =>
          r.type === 'HOLIDAY' &&
          r.is_recurring &&
          ((r.day_of_week !== undefined && r.day_of_week === dayOfWeek) ||
            (r.month !== undefined &&
              r.month === month &&
              r.day !== undefined &&
              r.day === day)),
      );

      if (holidayRestriction) {
        holidays.push({
          date: date.toISOString().split('T')[0], // YYYY-MM-DD format
          day_of_week: dayOfWeek,
          description: holidayRestriction.description || 'Holiday',
        });
      }
    }

    return holidays;
  }

  // ✅ NEW: Get month name helper
  private getMonthName(month: number): string {
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return monthNames[month - 1];
  }
}
