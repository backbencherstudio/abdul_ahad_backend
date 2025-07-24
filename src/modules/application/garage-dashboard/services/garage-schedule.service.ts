import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { CreateCalendarDto } from '../dto/create-calendar.dto';

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
        },
        create: {
          garage_id: garageId,
          day_of_week: dto.day_of_week,
          is_active: dto.is_active,
          start_time: dto.start_time,
          end_time: dto.end_time,
        },
      });
      results.push(schedule);
    }
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
    const existing = await this.prisma.calendar.findFirst({
      where: {
        garage_id: garageId,
        event_date: new Date(
          new Date(dto.event_date).toISOString().slice(0, 10) + 'T00:00:00Z',
        ),
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
          description: dto.description,
        },
      });
    } else {
      event = await this.prisma.calendar.create({
        data: {
          garage_id: garageId,
          event_date: new Date(
            new Date(dto.event_date).toISOString().slice(0, 10) + 'T00:00:00Z',
          ),
          type: dto.type,
          start_time: dto.type === 'OPEN' ? dto.start_time : null,
          end_time: dto.type === 'OPEN' ? dto.end_time : null,
          description: dto.description,
        },
      });
    }
    return { success: true, message: 'Calendar event upserted', data: event };
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
}
