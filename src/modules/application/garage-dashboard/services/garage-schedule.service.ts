import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { CreateCalendarDto } from '../dto/create-calendar.dto';
import { ManualSlotDto } from '../dto/manual-slot.dto';

// Helper: Get all dates in a month, grouped by week (weeks start on Sunday)
function getMonthWeeks(year: number, month: number): Date[][] {
  // month: 1-12
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  const weeks: Date[][] = [];
  let current = new Date(firstDay);
  // Move to the first Sunday before or on the 1st
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
  // Accepts "HH:mm" or "HH:mmAM/PM"
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

  // Get weekly schedule
  async getSchedules(garageId: string) {
    const schedules = await this.prisma.garageSchedule.findMany({
      where: { garage_id: garageId },
      orderBy: { day_of_week: 'asc' },
    });
    return { success: true, data: schedules };
  }

  // Upsert all 7 days at once
  async createSchedule(garageId: string, dtos: CreateScheduleDto[]) {
    if (!Array.isArray(dtos) || dtos.length !== 7) {
      throw new BadRequestException('Must provide 7 days of schedule');
    }
    const results = [];
    for (const dto of dtos) {
      if (dto.is_active) {
        if (
          !isValidTimeFormat(dto.start_time) ||
          !isValidTimeFormat(dto.end_time)
        ) {
          throw new BadRequestException(
            'Invalid time format for start or end time',
          );
        }
        if (!isStartBeforeEnd(dto.start_time, dto.end_time)) {
          throw new BadRequestException('Start time must be before end time');
        }
      }
      const schedule = await this.prisma.garageSchedule.upsert({
        where: {
          garage_id_day_of_week: {
            garage_id: garageId,
            day_of_week: dto.day_of_week,
          },
        },
        update: {
          is_active: dto.is_active,
          start_time: dto.start_time,
          end_time: dto.end_time,
          slot_duration: dto.slot_duration,
        },
        create: {
          garage_id: garageId,
          day_of_week: dto.day_of_week,
          is_active: dto.is_active,
          start_time: dto.start_time,
          end_time: dto.end_time,
          slot_duration: dto.slot_duration,
        },
      });
      results.push(schedule);
    }

    // --- NEW: Generate slots for the next 30 days for all active days ---
    const today = new Date();
    const daysToGenerate = 30;
    for (let i = 0; i < daysToGenerate; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      const schedule = dtos.find((s) => s.day_of_week === dow && s.is_active);
      if (schedule) {
        await this.generateTimeSlotsForRange(garageId, d, d);
      }
    }
    // -------------------------------------------------------------------

    return { success: true, message: 'Schedule updated', data: results };
  }

  // Update a single day's schedule
  async updateSchedule(garageId: string, id: string, dto: CreateScheduleDto) {
    const schedule = await this.prisma.garageSchedule.findFirst({
      where: { id, garage_id: garageId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    if (dto.is_active) {
      if (
        !isValidTimeFormat(dto.start_time) ||
        !isValidTimeFormat(dto.end_time)
      ) {
        throw new BadRequestException(
          'Invalid time format for start or end time',
        );
      }
      if (!isStartBeforeEnd(dto.start_time, dto.end_time)) {
        throw new BadRequestException('Start time must be before end time');
      }
    }
    const updated = await this.prisma.garageSchedule.update({
      where: { id },
      data: {
        is_active: dto.is_active,
        start_time: dto.start_time,
        end_time: dto.end_time,
        slot_duration: dto.slot_duration,
      },
    });
    return { success: true, message: 'Schedule updated', data: updated };
  }

  // Get all holidays/exceptions
  async getCalendar(garageId: string) {
    const events = await this.prisma.calendar.findMany({
      where: { garage_id: garageId },
      orderBy: { event_date: 'asc' },
    });
    return { success: true, data: events };
  }

  // Upsert (add or update) a holiday/exception
  async upsertCalendarEvent(garageId: string, dto: CreateCalendarDto) {
    if (dto.type === 'OPEN') {
      if (
        !isValidTimeFormat(dto.start_time) ||
        !isValidTimeFormat(dto.end_time)
      ) {
        throw new BadRequestException(
          'Invalid time format for start or end time',
        );
      }
      if (!isStartBeforeEnd(dto.start_time, dto.end_time)) {
        throw new BadRequestException('Start time must be before end time');
      }
    }
    const eventDate = new Date(
      new Date(dto.event_date).toISOString().slice(0, 10) + 'T00:00:00Z',
    );
    const existing = await this.prisma.calendar.findFirst({
      where: {
        garage_id: garageId,
        event_date: eventDate,
      },
    });
    let event;
    if (existing) {
      event = await this.prisma.calendar.update({
        where: { id: existing.id },
        data: {
          type: dto.type,
          start_time: dto.type === 'OPEN' ? dto.start_time : null,
          end_time: dto.type === 'OPEN' ? dto.end_time : null,
          slot_duration: dto.slot_duration ?? null,
          description: dto.description,
        },
      });
    } else {
      event = await this.prisma.calendar.create({
        data: {
          garage_id: garageId,
          event_date: eventDate,
          type: dto.type,
          start_time: dto.type === 'OPEN' ? dto.start_time : null,
          end_time: dto.type === 'OPEN' ? dto.end_time : null,
          slot_duration: dto.slot_duration ?? null,
          description: dto.description,
        },
      });
    }

    if (dto.type === 'HOLIDAY') {
      await this.prisma.timeSlot.deleteMany({
        where: { garage_id: garageId, date: eventDate },
      });
      return {
        success: true,
        message: 'Holiday set and slots deleted',
        data: event,
      };
    } else {
      await this.generateTimeSlotsForRange(garageId, eventDate, eventDate);
      return {
        success: true,
        message: 'Calendar event upserted and slots regenerated',
        data: event,
      };
    }
  }

  // Remove a holiday/exception
  async deleteCalendarEvent(garageId: string, id: string) {
    const event = await this.prisma.calendar.findFirst({
      where: { id, garage_id: garageId },
    });
    if (!event) throw new NotFoundException('Event not found');
    await this.prisma.calendar.delete({ where: { id } });
    return { success: true, message: 'Calendar event deleted' };
  }

  async deleteAllCalendarEvents(garageId: string) {
    const result = await this.prisma.calendar.deleteMany({
      where: { garage_id: garageId },
    });
    return {
      success: true,
      message: 'All calendar events deleted',
      count: result.count,
    };
  }

  // Main function: Get month status grouped by week
  async getMonthWeeksStatus(garageId: string, year: number, month: number) {
    const weeks = getMonthWeeks(year, month);
    const allDates = weeks.flat(); // Array of Date objects

    const exceptions = await this.prisma.calendar.findMany({
      where: {
        garage_id: garageId,
        event_date: { in: allDates },
      },
    });
    // console.log(allDates);
    const schedule = await this.prisma.garageSchedule.findMany({
      where: { garage_id: garageId },
    });
    const weekStatus = weeks.map((week) =>
      week.map((date) => {
        const dateStr = date.toISOString().slice(0, 10);
        const dayOfWeek = date.getDay();
        const exception = exceptions.find(
          (e) => new Date(e.event_date).toISOString().slice(0, 10) === dateStr,
        );
        let isHoliday = false;
        let isWorking = false;
        let isWeekend = false;
        let start_time: string | null = null;
        let end_time: string | null = null;

        if (exception) {
          if (exception.type === 'HOLIDAY') {
            isHoliday = true;
          } else if (exception.type === 'CLOSED') {
            isWeekend = true;
          } else if (exception.type === 'OPEN') {
            isWorking = true;
            start_time = exception.start_time;
            end_time = exception.end_time;
          }
        } else {
          const daySchedule = schedule.find((s) => s.day_of_week === dayOfWeek);
          if (daySchedule?.is_active) {
            isWorking = true;
            start_time = daySchedule.start_time;
            end_time = daySchedule.end_time;
          } else {
            isWeekend = true;
          }
        }

        return {
          date: dateStr,
          isHoliday,
          isWorking,
          isWeekend,
          start_time,
          end_time,
        };
      }),
    );
    return weekStatus;
  }

  async bulkSetCalendar(
    garageId: string,
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
    const start = new Date(body.start_date);
    const end = new Date(body.end_date);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new BadRequestException('Invalid start_date or end_date');
    }
    if (!Array.isArray(body.days) || body.days.length === 0) {
      throw new BadRequestException('days array is required');
    }

    // Optionally: delete all existing exceptions first
    await this.prisma.calendar.deleteMany({ where: { garage_id: garageId } });

    // Prepare events
    const events = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const pattern = body.days.find((day) => day.day_of_week === dow);
      if (!pattern) continue; // skip if not specified
      events.push({
        garage_id: garageId,
        event_date: new Date(
          new Date(d).toISOString().slice(0, 10) + 'T00:00:00Z',
        ),
        type: pattern.type,
        start_time: pattern.type === 'OPEN' ? pattern.start_time : null,
        end_time: pattern.type === 'OPEN' ? pattern.end_time : null,
        description: body.description,
      });
    }

    // Bulk create (in batches if needed)
    const BATCH_SIZE = 500;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      await this.prisma.calendar.createMany({
        data: events.slice(i, i + BATCH_SIZE),
        skipDuplicates: true,
      });
    }

    return {
      success: true,
      message: 'Bulk calendar events set',
      count: events.length,
    };
  }

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
    const schedules = await this.prisma.garageSchedule.findMany({
      where: { garage_id: garageId, is_active: true },
    });

    const calendarEvents = await this.prisma.calendar.findMany({
      where: {
        garage_id: garageId,
        event_date: { gte: startDate, lte: endDate },
      },
    });

    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const dayOfWeek = d.getDay();
      const event = calendarEvents.find(
        (e) =>
          e.event_date.toISOString().slice(0, 10) ===
          d.toISOString().slice(0, 10),
      );

      // If there's a calendar event for this date
      if (event) {
        if (event.type === 'HOLIDAY') continue; // skip holidays

        const startTime = event.start_time;
        const endTime = event.end_time;
        const slotDuration = event.slot_duration;

        if (!startTime || !endTime || !slotDuration) continue; // skip if missing info

        const slots = this.generateSlotsForDay(
          startTime,
          endTime,
          slotDuration,
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
        continue; // skip to next day
      }

      // No calendar event: use weekly schedule
      const schedule = schedules.find((s) => s.day_of_week === dayOfWeek);
      if (
        !schedule ||
        !schedule.start_time ||
        !schedule.end_time ||
        !schedule.slot_duration
      )
        continue;

      const slots = this.generateSlotsForDay(
        schedule.start_time,
        schedule.end_time,
        schedule.slot_duration,
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
    await this.prisma.timeSlot.update({
      where: { id: slotId },
      data: { is_blocked: isBlocked },
    });
    return {
      success: true,
      message: isBlocked ? 'Slot blocked' : 'Slot unblocked',
    };
  }

  // Update slot duration for a specific day of week
  async updateSlotDuration(
    garageId: string,
    dayOfWeek: number,
    slotDuration: number,
  ) {
    const schedule = await this.prisma.garageSchedule.findFirst({
      where: { garage_id: garageId, day_of_week: dayOfWeek },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    await this.prisma.garageSchedule.update({
      where: { id: schedule.id },
      data: { slot_duration: slotDuration },
    });

    // Regenerate slots for the next 30 days for this dayOfWeek
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if (d.getDay() === dayOfWeek) {
        await this.generateTimeSlotsForRange(garageId, d, d);
      }
    }

    return {
      success: true,
      message: 'Slot duration updated and slots regenerated',
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
}
