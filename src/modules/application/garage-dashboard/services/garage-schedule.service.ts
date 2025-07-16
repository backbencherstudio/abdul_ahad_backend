import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { CreateCalendarDto } from '../dto/create-calendar.dto';

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
    // Validate input: should be 7 days
    if (!Array.isArray(dtos) || dtos.length !== 7) {
      throw new Error('Must provide 7 days of schedule');
    }
    // Upsert each day
    const results = [];
    for (const dto of dtos) {
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

  // Add a holiday/exception
  async addCalendarEvent(garageId: string, dto: CreateCalendarDto) {
    const event = await this.prisma.calendar.create({
      data: {
        garage_id: garageId,
        event_date: new Date(dto.event_date),
        type: dto.type,
        description: dto.description,
      },
    });
    return { success: true, message: 'Calendar event added', data: event };
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
}
