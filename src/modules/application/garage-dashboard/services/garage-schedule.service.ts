import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ManualSlotDto } from '../dto/manual-slot.dto';
import { ScheduleDto, SetWeeklyPatternDto } from '../dto/schedule.dto';

// Helper: Get all dates in a month, grouped by week (weeks start on Sunday)
function getMonthWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  const weeks: Date[][] = [];
  let current = new Date(firstDay);
  current.setUTCDate(current.getUTCDate() - current.getUTCDay());
  while (current <= lastDay || weeks.length === 0) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function isValidTimeFormat(time: string): boolean {
  return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](AM|PM)?$/.test(time);
}

function isStartBeforeEnd(start: string, end: string): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return false;
  return sh < eh || (sh === eh && sm < em);
}

@Injectable()
export class GarageScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== SCHEDULE MANAGEMENT ====================

  // Get schedule for any date (unified)
  async getScheduleForDate(garageId: string, date: string) {
    const targetDate = new Date(date + 'T00:00:00Z');
    const dayOfWeek = targetDate.getDay();

    // 1. Check for specific date exception (non-recurring)
    const specific = await this.prisma.calendar.findFirst({
      where: {
        garage_id: garageId,
        event_date: targetDate,
        is_recurring: false,
      },
    });

    if (specific) {
      return {
        success: true,
        data: {
          date,
          day_of_week: dayOfWeek,
          schedule: specific,
          source: 'specific_date',
        },
      };
    }

    // 2. Fall back to weekly pattern (recurring)
    const weekly = await this.prisma.calendar.findFirst({
      where: {
        garage_id: garageId,
        day_of_week: dayOfWeek,
        is_recurring: true,
      },
    });

    return {
      success: true,
      data: {
        date,
        day_of_week: dayOfWeek,
        schedule: weekly,
        source: weekly ? 'weekly_pattern' : 'no_schedule',
      },
    };
  }

  // Get week view (7 days)
  async getWeekSchedule(garageId: string, startDate: string) {
    const start = new Date(startDate + 'T00:00:00Z');
    const weekSchedules = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);

      const schedule = await this.getScheduleForDate(garageId, dateStr);
      weekSchedules.push(schedule.data);
    }

    return { success: true, data: weekSchedules };
  }

  // Get month view
  async getMonthSchedule(garageId: string, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const schedules = await this.prisma.calendar.findMany({
      where: {
        garage_id: garageId,
        event_date: {
          gte: startDate,
          lte: endDate,
        },
        is_recurring: false, // Only specific dates, not weekly patterns
      },
      orderBy: { event_date: 'asc' },
    });

    return { success: true, data: schedules };
  }

  // Set/Update schedule for specific date
  async setScheduleForDate(garageId: string, dto: ScheduleDto) {
    if (dto.type === 'OPEN') {
      if (
        !isValidTimeFormat(dto.start_time) ||
        !isValidTimeFormat(dto.end_time)
      ) {
        throw new BadRequestException('Invalid time format');
      }
      if (!isStartBeforeEnd(dto.start_time, dto.end_time)) {
        throw new BadRequestException('Start time must be before end time');
      }
    }

    const eventDate = new Date(dto.date + 'T00:00:00Z');
    const dayOfWeek = eventDate.getDay();

    const schedule = await this.prisma.calendar.upsert({
      where: {
        garage_id_event_date_is_recurring_day_of_week: {
          garage_id: garageId,
          event_date: eventDate,
          is_recurring: false,
          day_of_week: dayOfWeek, // <-- use actual day of week, not null
        },
      },
      update: {
        type: dto.type,
        start_time: dto.start_time,
        end_time: dto.end_time,
        slot_duration: dto.slot_duration,
        // description: dto.description, // REMOVE if not needed
      },
      create: {
        garage_id: garageId,
        event_date: eventDate,
        type: dto.type,
        start_time: dto.start_time,
        end_time: dto.end_time,
        slot_duration: dto.slot_duration,
        is_recurring: false,
        day_of_week: dayOfWeek, // <-- use actual day of week
        // description: dto.description, // REMOVE if not needed
      },
    });

    // Generate slots if it's an OPEN type
    if (dto.type === 'OPEN') {
      await this.generateTimeSlotsForRange(garageId, eventDate, eventDate);
    } else if (dto.type === 'HOLIDAY') {
      await this.prisma.timeSlot.deleteMany({
        where: { garage_id: garageId, date: eventDate },
      });
    }

    return { success: true, message: 'Schedule set for date', data: schedule };
  }

  // Set weekly pattern (updated to handle reset state)
  async setWeeklyPattern(garageId: string, dto: SetWeeklyPatternDto) {
    if (!Array.isArray(dto.pattern) || dto.pattern.length !== 7) {
      throw new BadRequestException('Must provide 7 days of pattern');
    }

    // Validate daysToGenerate
    const daysToGenerate = dto.daysToGenerate || 90; // Default to 90 days
    if (daysToGenerate < 1 || daysToGenerate > 365) {
      throw new BadRequestException('daysToGenerate must be between 1 and 365');
    }

    // Validate each day
    for (const day of dto.pattern) {
      if (day.type === 'OPEN') {
        if (
          !isValidTimeFormat(day.start_time) ||
          !isValidTimeFormat(day.end_time)
        ) {
          throw new BadRequestException(
            `Invalid time format for day ${day.day_of_week}`,
          );
        }
        if (!isStartBeforeEnd(day.start_time, day.end_time)) {
          throw new BadRequestException(
            `Start time must be before end time for day ${day.day_of_week}`,
          );
        }
      }
    }

    // Delete existing recurring patterns
    await this.prisma.calendar.deleteMany({
      where: { garage_id: garageId, is_recurring: true },
    });

    // Create new recurring patterns
    const schedules = [];
    for (const day of dto.pattern) {
      const placeholderDate = new Date('2025-01-01');
      placeholderDate.setDate(1 + day.day_of_week);

      const schedule = await this.prisma.calendar.create({
        data: {
          garage_id: garageId,
          event_date: placeholderDate,
          day_of_week: day.day_of_week,
          is_recurring: true,
          type: day.type,
          start_time: day.start_time,
          end_time: day.end_time,
          slot_duration: day.slot_duration,
        },
      });
      schedules.push(schedule);
    }

    // Clear reset flag since user has set a pattern
    await this.prisma.user.update({
      where: { id: garageId },
      data: { is_reset: false },
    });

    // Generate slots for the specified number of days
    const today = new Date();
    for (let i = 0; i < daysToGenerate; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      await this.generateTimeSlotsForRange(garageId, d, d);
    }

    // Calculate end date for response
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysToGenerate - 1);

    return {
      success: true,
      message: `Weekly pattern set and slots generated for ${daysToGenerate} days`,
      data: {
        schedules,
        is_reset: false,
        slots_generated_for_days: daysToGenerate,
        slots_generated_from: today.toISOString().slice(0, 10),
        slots_generated_until: endDate.toISOString().slice(0, 10),
        estimated_slots_count: Math.ceil(daysToGenerate * 0.7 * 8), // Rough estimate
      },
    };
  }

  // Delete schedule for date
  async deleteScheduleForDate(garageId: string, date: string) {
    const eventDate = new Date(date + 'T00:00:00Z');

    const result = await this.prisma.calendar.deleteMany({
      where: {
        garage_id: garageId,
        event_date: eventDate,
        is_recurring: false, // Only delete specific dates, not weekly patterns
      },
    });

    // Also delete slots for this date
    await this.prisma.timeSlot.deleteMany({
      where: { garage_id: garageId, date: eventDate },
    });

    return {
      success: true,
      message: 'Schedule deleted for date',
      count: result.count,
    };
  }

  // ==================== SLOT MANAGEMENT ====================

  // Utility: Generate slots for a day
  private generateSlotsForDay(
    startTime: string,
    endTime: string,
    slotDuration: number,
  ): { start: string; end: string }[] {
    const slots = [];
    let [sh, sm] = startTime.split(':').map(Number);
    let [eh, em] = endTime.split(':').map(Number);

    let start = sh * 60 + sm;
    const end = eh * 60 + em;

    while (start + slotDuration <= end) {
      const slotStartH = Math.floor(start / 60)
        .toString()
        .padStart(2, '0');
      const slotStartM = (start % 60).toString().padStart(2, '0');
      const slotEnd = start + slotDuration;
      const slotEndH = Math.floor(slotEnd / 60)
        .toString()
        .padStart(2, '0');
      const slotEndM = (slotEnd % 60).toString().padStart(2, '0');
      slots.push({
        start: `${slotStartH}:${slotStartM}`,
        end: `${slotEndH}:${slotEndM}`,
      });
      start += slotDuration;
    }
    return slots;
  }

  // Main: Generate slots for a date range
  async generateTimeSlotsForRange(
    garageId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const calendarEvents = await this.prisma.calendar.findMany({
      where: {
        garage_id: garageId,
        OR: [
          {
            event_date: { gte: startDate, lte: endDate },
            is_recurring: false,
          },
          {
            is_recurring: true,
          },
        ],
      },
    });

    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const dayOfWeek = d.getDay();
      const specificEvent = calendarEvents.find(
        (e) =>
          !e.is_recurring &&
          e.event_date.toISOString().slice(0, 10) ===
            d.toISOString().slice(0, 10),
      );

      const weeklyEvent = calendarEvents.find(
        (e) => e.is_recurring && e.day_of_week === dayOfWeek,
      );

      // Use specific event if exists, otherwise use weekly pattern
      const event = specificEvent || weeklyEvent;

      if (!event || event.type === 'HOLIDAY') {
        // Delete slots for holidays
        await this.prisma.timeSlot.deleteMany({
          where: { garage_id: garageId, date: d },
        });
        continue;
      }

      if (
        event.type !== 'OPEN' ||
        !event.start_time ||
        !event.end_time ||
        !event.slot_duration
      ) {
        continue;
      }

      const slots = this.generateSlotsForDay(
        event.start_time,
        event.end_time,
        event.slot_duration,
      );

      for (const slot of slots) {
        await this.prisma.timeSlot.upsert({
          where: {
            garage_id_date_start_time: {
              garage_id: garageId,
              date: new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z'),
              start_time: slot.start,
            },
          },
          update: {},
          create: {
            garage_id: garageId,
            date: new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z'),
            start_time: slot.start,
            end_time: slot.end,
          },
        });
      }
    }
    return { success: true };
  }

  // Get all slots for a given date
  async getSlotsForDate(garageId: string, date: string) {
    const slots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        date: new Date(date + 'T00:00:00Z'),
      },
      orderBy: { start_time: 'asc' },
    });
    return { success: true, data: slots };
  }

  // Block or unblock a specific slot
  async setSlotBlockedStatus(
    garageId: string,
    slotId: string,
    isBlocked: boolean,
  ) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    // If trying to unblock a slot that's already booked, prevent it
    if (!isBlocked && slot.order_id) {
      throw new BadRequestException(
        'Cannot unblock a slot that is already booked',
      );
    }

    await this.prisma.timeSlot.update({
      where: { id: slotId },
      data: {
        is_blocked: isBlocked,
        is_available: !isBlocked && !slot.order_id, // Only available if not blocked AND not booked
      },
    });

    return {
      success: true,
      message: isBlocked
        ? 'Slot blocked and unavailable'
        : 'Slot unblocked and available',
    };
  }

  async setManualSlotsForDate(garageId: string, dto: ManualSlotDto) {
    const date = new Date(dto.date + 'T00:00:00Z');
    const slots = dto.slots;

    // 1. Fetch existing slots for the date
    const existingSlots = await this.prisma.timeSlot.findMany({
      where: { garage_id: garageId, date },
      orderBy: { start_time: 'asc' },
    });

    // 2. If replace mode, delete all existing slots
    if (dto.replace) {
      await this.prisma.timeSlot.deleteMany({
        where: { garage_id: garageId, date },
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
          if (
            newSlot.start_time < exist.end_time &&
            newSlot.end_time > exist.start_time
          ) {
            throw new BadRequestException(
              `Slot ${newSlot.start_time}–${newSlot.end_time} overlaps with existing slot ${exist.start_time}–${exist.end_time}`,
            );
          }
        }
      }
    }

    // 5. Insert new slots
    for (const slot of slots) {
      await this.prisma.timeSlot.create({
        data: {
          garage_id: garageId,
          date,
          start_time: slot.start_time,
          end_time: slot.end_time,
        },
      });
    }

    // 6. Sync calendar event start/end time
    await this.syncCalendarEventTimeWithSlots(garageId, date);

    return {
      success: true,
      message: dto.replace
        ? 'Slots replaced for date'
        : 'Manual slots added for date',
      count: slots.length,
    };
  }

  async removeAllSlotsForDate(garageId: string, date: string) {
    const d = new Date(date + 'T00:00:00Z');
    const result = await this.prisma.timeSlot.deleteMany({
      where: { garage_id: garageId, date: d },
    });
    return {
      success: true,
      message: 'All slots removed for date',
      count: result.count,
    };
  }

  async deleteSlotById(garageId: string, slotId: string) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    await this.prisma.timeSlot.delete({ where: { id: slotId } });
    return { success: true, message: 'Slot deleted' };
  }

  async syncCalendarEventTimeWithSlots(garageId: string, date: Date) {
    const slots = await this.prisma.timeSlot.findMany({
      where: { garage_id: garageId, date },
      orderBy: { start_time: 'asc' },
    });
    if (!slots.length) return;
    const start_time = slots[0].start_time;
    const end_time = slots[slots.length - 1].end_time;
    await this.prisma.calendar.updateMany({
      where: { garage_id: garageId, event_date: date },
      data: { start_time, end_time },
    });
  }

  async updateSlotById(
    garageId: string,
    slotId: string,
    newStart: string,
    newEnd: string,
  ) {
    const slot = await this.prisma.timeSlot.findFirst({
      where: { id: slotId, garage_id: garageId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (
      !isValidTimeFormat(newStart) ||
      !isValidTimeFormat(newEnd) ||
      !isStartBeforeEnd(newStart, newEnd)
    ) {
      throw new BadRequestException('Invalid start or end time');
    }
    // Check for overlap with other slots for the same date
    const overlapping = await this.prisma.timeSlot.findFirst({
      where: {
        garage_id: garageId,
        date: slot.date,
        id: { not: slotId },
        OR: [
          {
            start_time: { lt: newEnd },
            end_time: { gt: newStart },
          },
        ],
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `Slot ${newStart}–${newEnd} overlaps with existing slot ${overlapping.start_time}–${overlapping.end_time}`,
      );
    }
    await this.prisma.timeSlot.update({
      where: { id: slotId },
      data: { start_time: newStart, end_time: newEnd },
    });
    // Sync calendar event
    await this.syncCalendarEventTimeWithSlots(garageId, slot.date);
    return { success: true, message: 'Slot updated' };
  }

  // Complete reset - delete everything
  async completeReset(garageId: string) {
    // Delete in order to avoid foreign key issues
    const weeklyResult = await this.prisma.calendar.deleteMany({
      where: { garage_id: garageId, is_recurring: true },
    });

    const calendarResult = await this.prisma.calendar.deleteMany({
      where: { garage_id: garageId, is_recurring: false },
    });

    const slotsResult = await this.prisma.timeSlot.deleteMany({
      where: { garage_id: garageId },
    });

    // Set reset flag for the user
    await this.prisma.user.update({
      where: { id: garageId },
      data: { is_reset: true },
    });

    const totalDeleted =
      weeklyResult.count + calendarResult.count + slotsResult.count;

    return {
      success: true,
      message:
        totalDeleted > 0
          ? 'Complete schedule reset successful'
          : 'No data found to reset',
      data: {
        weekly_patterns_deleted: weeklyResult.count,
        calendar_events_deleted: calendarResult.count,
        time_slots_deleted: slotsResult.count,
        total_deleted: totalDeleted,
        is_reset: true,
      },
    };
  }

  // Get user reset state
  async getResetState(garageId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: garageId },
      select: { is_reset: true },
    });

    return {
      success: true,
      data: {
        is_reset: user?.is_reset || false,
      },
    };
  }
}
