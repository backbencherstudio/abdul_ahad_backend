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
import {
  SlotModificationDto,
  ModificationResult,
  ModificationType,
} from '../dto/slot-modification.dto';
import { ModifySlotTimeDto } from '../dto/modify-slot-time.dto';

import {
  getWeekDateRange,
  getCurrentWeekInfo,
  generateWeekSchedule,
  validateWeekNumber,
  getMonthName,
  CurrentWeekInfo,
  WeekDateRange,
  generateHolidaysForMonth,
} from './calendar-view.helper';

@Injectable()
export class GarageScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  // Time Handling Helper Methods
  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private formatTime24Hour(date: Date): string {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private isValidTimeFormat(time: string): boolean {
    const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!regex.test(time)) return false;
    const [hours, minutes] = time.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  private isStartBeforeEnd(start: string, end: string): boolean {
    const startMins = this.parseTimeToMinutes(start);
    const endMins = this.parseTimeToMinutes(end);
    return startMins < endMins;
  }

  private isTimeInBreak(
    restrictions: RestrictionDto[],
    date: Date,
    startTime: string,
    endTime: string,
  ): { isBreak: boolean; breakInfo?: RestrictionDto } {
    const dayOfWeek = date.getDay();
    const slotStartMins = this.parseTimeToMinutes(startTime);
    const slotEndMins = this.parseTimeToMinutes(endTime);

    for (const restriction of restrictions) {
      if (
        restriction.type === 'BREAK' &&
        Array.isArray(restriction.day_of_week) &&
        restriction.day_of_week.includes(dayOfWeek)
      ) {
        const breakStartMins = this.parseTimeToMinutes(restriction.start_time);
        const breakEndMins = this.parseTimeToMinutes(restriction.end_time);

        // Check if slot overlaps with break
        if (
          (slotStartMins >= breakStartMins && slotStartMins < breakEndMins) ||
          (slotEndMins > breakStartMins && slotEndMins <= breakEndMins) ||
          (slotStartMins <= breakStartMins && slotEndMins >= breakEndMins)
        ) {
          return { isBreak: true, breakInfo: restriction };
        }
      }
    }
    return { isBreak: false };
  }

  // ✅ FIXED: Enhanced day restriction check with debug
  private isDayRestricted(restrictions: RestrictionDto[], date: Date): boolean {
    const dayOfWeek = date.getDay();

    // Ensure restrictions is an array
    if (!Array.isArray(restrictions)) {
      return false;
    }

    const result = restrictions.some((r) => {
      if (r.type !== 'HOLIDAY') {
        return false;
      }

      // Handle both single day and array of days
      if (Array.isArray(r.day_of_week)) {
        const matches = r.day_of_week.includes(dayOfWeek);
        return matches;
      }

      // Handle string vs number comparison
      const restrictionDay =
        typeof r.day_of_week === 'string'
          ? parseInt(r.day_of_week, 10)
          : r.day_of_week;

      const matches = restrictionDay === dayOfWeek;
      return matches;
    });

    return result;
  }

  // ✅ FIXED: Make slot duration validation flexible
  private validateSlotDuration(
    startTime: string,
    endTime: string,
    expectedDuration: number,
    allowFlexibleDuration: boolean = false,
  ): void {
    const duration =
      this.parseTimeToMinutes(endTime) - this.parseTimeToMinutes(startTime);

    if (!allowFlexibleDuration && duration !== expectedDuration) {
      throw new BadRequestException(
        `Slot duration must be ${expectedDuration} minutes. Got ${duration} minutes.`,
      );
    }

    // Even with flexible duration, ensure minimum and maximum bounds
    if (duration < 15) {
      throw new BadRequestException(
        `Slot duration must be at least 15 minutes. Got ${duration} minutes.`,
      );
    }

    if (duration > 480) {
      // 8 hours max
      throw new BadRequestException(
        `Slot duration cannot exceed 480 minutes (8 hours). Got ${duration} minutes.`,
      );
    }
  }

  // ✅ ENHANCED: Enhanced slot display formatting with status array support
  private formatSlotForDisplay(slot: any) {
    // Always use the actual database datetime values for display
    const localStart = new Date(slot.start_datetime);
    const localEnd = new Date(slot.end_datetime);
    const startTime = this.formatTime24Hour(localStart);
    const endTime = this.formatTime24Hour(localEnd);

    // Base slot object with essential information
    const cleanSlot: any = {
      time: `${startTime}-${endTime}`,
      status: Array.isArray(slot.status)
        ? slot.status
        : this.getSlotStatus(slot), // ✅ Support both array and single status
    };

    // Add database-specific fields only for database slots
    if (slot.id) {
      cleanSlot.id = slot.id;
      cleanSlot.source = 'DATABASE';

      // Add modification info if slot was modified
      if (slot.modification_reason) {
        cleanSlot.modification_reason = slot.modification_reason;
      }

      if (slot.modification_type) {
        cleanSlot.modification_type = slot.modification_type;
      }
    } else {
      cleanSlot.source = 'TEMPLATE';
    }

    // Add break/holiday-specific information
    if (slot.type === 'BREAK' && slot.description) {
      cleanSlot.description = slot.description;
    }

    if (slot.type === 'HOLIDAY' && slot.description) {
      cleanSlot.description = slot.description;
    }

    return cleanSlot;
  }

  // ✅ ENHANCED: Unified status system with array support
  private getSlotStatus(slot: any): string[] {
    const statuses: string[] = [];

    // Check for booking (highest priority)
    if (slot.order_id) {
      statuses.push('BOOKED');
    }

    // Check for break time
    if (slot.type === 'BREAK') {
      statuses.push('BREAK');
    }

    // Check for holiday
    if (slot.type === 'HOLIDAY') {
      statuses.push('HOLIDAY');
    }

    // Check for blocking
    if (slot.is_blocked && !slot.order_id) {
      statuses.push('BLOCKED');
    }

    // Check for modifications
    if (slot.modification_type) {
      statuses.push('MODIFIED');
    }

    // Default to available if no other status
    if (statuses.length === 0) {
      statuses.push('AVAILABLE');
    }

    return statuses;
  }

  // ✅ NEW: Enhanced status combination for conflicts
  private combineSlotStatuses(slot: any, additionalStatus: string): string[] {
    const baseStatuses = this.getSlotStatus(slot);

    // Add additional status if not already present
    if (!baseStatuses.includes(additionalStatus)) {
      baseStatuses.push(additionalStatus);
    }

    return baseStatuses;
  }

  private getModificationType(action: string): ModificationType | null {
    switch (action) {
      case 'BLOCK':
        return ModificationType.MANUAL_BLOCK;
      case 'TIME_MODIFIED':
        return ModificationType.TIME_MODIFIED;
      case 'BOOKED':
        return ModificationType.BOOKED;
      case 'UNBLOCK':
        return null;
      default:
        return null;
    }
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
        .isBreak
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

  // Enhanced remove all slots for a date
  async removeAllSlotsForDate(garageId: string, date: string) {
    // ✅ FIXED: Use local timezone
    const startDate = new Date(date + 'T00:00:00');
    const endDate = new Date(date + 'T23:59:59');

    // ✅ NEW: First check if any slots exist
    const existingSlots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        start_datetime: true,
        end_datetime: true,
        order_id: true,
        modification_reason: true,
      },
    });

    // ✅ NEW: Separate booked and available slots
    const bookedSlots = existingSlots.filter((slot) => slot.order_id);
    const availableSlots = existingSlots.filter((slot) => !slot.order_id);

    if (existingSlots.length === 0) {
      return {
        success: true,
        message:
          'No manual slots found for this date. Only template slots exist.',
        count: 0,
        details: {
          total_slots: 0,
          booked_slots: 0,
          available_slots: 0,
          note: 'Template slots (generated from schedule) cannot be deleted individually. They will be regenerated automatically.',
        },
      };
    }

    if (bookedSlots.length > 0) {
      return {
        success: false,
        message: `Cannot remove all slots: ${bookedSlots.length} slot(s) are booked`,
        count: 0,
        details: {
          total_slots: existingSlots.length,
          booked_slots: bookedSlots.length,
          available_slots: availableSlots.length,
          booked_slot_times: bookedSlots.map(
            (slot) =>
              `${this.formatTime24Hour(slot.start_datetime)}-${this.formatTime24Hour(slot.end_datetime)}`,
          ),
        },
      };
    }

    // ✅ NEW: Delete only available slots
    const result = await this.prisma.timeSlot.deleteMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: startDate,
          lte: endDate,
        },
        order_id: null, // Only delete non-booked slots
      },
    });

    return {
      success: true,
      message: `Successfully removed ${result.count} manual slot(s) for the date`,
      count: result.count,
      details: {
        total_slots: existingSlots.length,
        deleted_slots: result.count,
        booked_slots: 0,
        available_slots: availableSlots.length,
        deleted_slot_times: availableSlots.map(
          (slot) =>
            `${this.formatTime24Hour(slot.start_datetime)}-${this.formatTime24Hour(slot.end_datetime)}`,
        ),
      },
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

    // ✅ NEW: Protect booked slots
    if (slot.order_id) {
      throw new BadRequestException('Cannot delete a booked slot.');
    }

    await this.prisma.timeSlot.delete({ where: { id: slotId } });

    return {
      success: true,
      message: 'Slot deleted successfully',
      deleted_slot: {
        id: slot.id,
        time: `${this.formatTime24Hour(slot.start_datetime)}-${this.formatTime24Hour(slot.end_datetime)}`,
        modification_reason: slot.modification_reason,
      },
    };
  }

  // Modified slot modification method
  async modifySlots(
    garageId: string,
    dto: SlotModificationDto,
  ): Promise<ModificationResult> {
    return await this.prisma.$transaction(async (tx) => {
      try {
        const schedule = await tx.schedule.findUnique({
          where: { garage_id: garageId },
        });

        if (!schedule) {
          throw new NotFoundException('Schedule not found');
        }

        // Validate times
        if (
          !this.isValidTimeFormat(dto.start_time) ||
          !this.isValidTimeFormat(dto.end_time)
        ) {
          throw new BadRequestException('Invalid time format');
        }

        // ✅ FIXED: Allow flexible duration for modifications
        this.validateSlotDuration(
          dto.start_time,
          dto.end_time,
          schedule.slot_duration,
          true, // Allow flexible duration
        );

        const restrictions = Array.isArray(schedule.restrictions)
          ? schedule.restrictions
          : JSON.parse(schedule.restrictions as string);

        const startDate = new Date(dto.start_date);
        const endDate = new Date(dto.end_date);

        // Generate slots to modify
        const slotsToModify = [];
        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
          // Skip if day is restricted
          if (!this.isDayRestricted(restrictions, currentDate)) {
            const [startHour, startMinute] = dto.start_time
              .split(':')
              .map(Number);
            const [endHour, endMinute] = dto.end_time.split(':').map(Number);

            const slotStart = new Date(currentDate);
            slotStart.setHours(startHour, startMinute, 0, 0);

            const slotEnd = new Date(currentDate);
            slotEnd.setHours(endHour, endMinute, 0, 0);

            // Check for break time
            const { isBreak } = this.isTimeInBreak(
              restrictions,
              currentDate,
              dto.start_time,
              dto.end_time,
            );

            if (!isBreak) {
              slotsToModify.push({
                start_datetime: slotStart,
                end_datetime: slotEnd,
              });
            }
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }

        const modifications = [];

        if (dto.action === 'UNBLOCK') {
          // Handle unblock
          const blockedSlots = await tx.timeSlot.findMany({
            where: {
              garage_id: garageId,
              start_datetime: {
                in: slotsToModify.map((slot) => slot.start_datetime),
              },
              is_blocked: true,
              order_id: null,
            },
          });

          for (const slot of blockedSlots) {
            const updated = await tx.timeSlot.update({
              where: { id: slot.id },
              data: {
                is_blocked: false,
                is_available: true,
                modification_type: null,
                modification_reason: null,
                modified_by: garageId,
              },
            });

            modifications.push({
              slot_id: updated.id,
              status: 'UPDATED',
            });
          }
        } else {
          // Handle block
          for (const slot of slotsToModify) {
            const created = await tx.timeSlot.upsert({
              where: {
                garage_id_start_datetime: {
                  garage_id: garageId,
                  start_datetime: slot.start_datetime,
                },
              },
              update: {
                is_blocked: true,
                is_available: false,
                modification_type: this.getModificationType('BLOCK'),
                modification_reason: dto.reason,
                modified_by: garageId,
                end_datetime: slot.end_datetime,
              },
              create: {
                garage_id: garageId,
                start_datetime: slot.start_datetime,
                end_datetime: slot.end_datetime,
                is_blocked: true,
                is_available: false,
                modification_type: this.getModificationType('BLOCK'),
                modification_reason: dto.reason,
                modified_by: garageId,
              },
            });

            modifications.push({
              slot_id: created.id,
              status: 'CREATED',
            });
          }
        }

        return {
          success: true,
          modifications,
          message: `Modified ${modifications.length} slots`,
        };
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof NotFoundException
        ) {
          throw error;
        }
        throw new BadRequestException('Failed to modify slots');
      }
    });
  }

  // ✅ NEW: Helper method to check if two slots overlap
  private slotsOverlap(slot1: any, slot2: any): boolean {
    const start1 = new Date(slot1.start_datetime).getTime();
    const end1 = new Date(slot1.end_datetime).getTime();
    const start2 = new Date(slot2.start_datetime).getTime();
    const end2 = new Date(slot2.end_datetime).getTime();

    // Check if slots overlap (one starts before the other ends and ends after the other starts)
    return start1 < end2 && end1 > start2;
  }

  // ✅ NEW: Helper method to check if a slot is within a time range
  private isSlotInTimeRange(
    slot: any,
    startTime: string,
    endTime: string,
    date: Date,
  ): boolean {
    const slotStart = this.formatTime24Hour(slot.start_datetime);
    const slotEnd = this.formatTime24Hour(slot.end_datetime);

    return slotStart >= startTime && slotEnd <= endTime;
  }

  // ✅ ENHANCED: Enhanced summary calculation with status array support
  private calculateEnhancedSummary(slots: any[]) {
    const summary = {
      total_slots: slots.length,
      by_status: {
        available: 0,
        booked: 0,
        blocked: 0,
        breaks: 0,
        modified: 0,
        holiday: 0,
        dual_status: 0, // ✅ NEW: Count slots with multiple statuses
      },
      by_source: {
        template: 0,
        database: 0,
      },
      modifications: 0,
    };

    for (const slot of slots) {
      const statuses = Array.isArray(slot.status) ? slot.status : [slot.status];

      // ✅ NEW: Count dual-status slots
      if (statuses.length > 1) {
        summary.by_status.dual_status++;
      }

      // Count by individual statuses
      for (const status of statuses) {
        switch (status) {
          case 'AVAILABLE':
            summary.by_status.available++;
            break;
          case 'BOOKED':
            summary.by_status.booked++;
            break;
          case 'BLOCKED':
            summary.by_status.blocked++;
            break;
          case 'BREAK':
            summary.by_status.breaks++;
            break;
          case 'MODIFIED':
            summary.by_status.modified++;
            break;
          case 'HOLIDAY':
            summary.by_status.holiday++;
            break;
        }
      }

      // Count by source
      if (slot.id) {
        summary.by_source.database++;
      } else {
        summary.by_source.template++;
      }

      // Count modifications
      if (slot.modification_type) {
        summary.modifications++;
      }
    }

    return summary;
  }

  // ✅ ENHANCED: View available slots with status array support
  async viewAvailableSlots(garageId: string, date: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule || !schedule.is_active) {
      throw new BadRequestException('No active schedule found.');
    }

    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    const targetDate = new Date(date + 'T00:00:00');

    // ✅ FIXED: Check if day is restricted (holiday)
    const isHoliday = this.isDayRestricted(restrictions, targetDate);

    // ✅ FIXED: Get existing slots first (even for holidays)
    const existingSlots = await this.prisma.timeSlot.findMany({
      where: {
        garage_id: garageId,
        start_datetime: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { start_datetime: 'asc' },
    });

    // ✅ FIXED: If holiday with no existing slots, return empty
    if (isHoliday && existingSlots.length === 0) {
      return {
        success: true,
        data: {
          garage_id: garageId,
          date,
          working_hours: {
            start: schedule.start_time,
            end: schedule.end_time,
          },
          slots: [],
          summary: {
            total_slots: 0,
            by_status: {
              available: 0,
              booked: 0,
              blocked: 0,
              breaks: 0,
              modified: 0,
              holiday: 0,
              dual_status: 0,
            },
            by_source: {
              template: 0,
              database: 0,
            },
            modifications: 0,
          },
          is_holiday: true,
        },
      };
    }

    // ✅ FIXED: If holiday with existing slots, show them with dual status
    if (isHoliday && existingSlots.length > 0) {
      const enhancedSlots = existingSlots.map((slot) => ({
        ...slot,
        type: 'HOLIDAY',
        is_available: false,
        is_blocked: true,
        status: ['HOLIDAY', ...this.getSlotStatus(slot)], // ✅ Dual status
        description: 'Holiday day with existing slot',
      }));

      const cleanSlots = enhancedSlots.map((slot) =>
        this.formatSlotForDisplay(slot),
      );

      const summary = this.calculateEnhancedSummary(enhancedSlots);

      return {
        success: true,
        data: {
          garage_id: garageId,
          date,
          working_hours: {
            start: schedule.start_time,
            end: schedule.end_time,
          },
          slots: cleanSlots,
          summary,
          is_holiday: true,
        },
      };
    }

   

    const potentialSlots = this.generateSlotsForDay(
      schedule.start_time,
      schedule.end_time,
      schedule.slot_duration,
      targetDate,
      garageId,
      restrictions, // Pass actual restrictions
      existingSlots, // ✅ NEW: Pass existing database slots
    );

    

    // ✅ FIXED: Enhanced slot merging with status array support
    const enhancedSlots = [];
    const processedTimeRanges = new Set(); // Track processed time ranges to avoid duplicates

    // Step 1: Process existing slots (database takes priority)
    for (const existingSlot of existingSlots) {
      const slotStartTime = this.formatTime24Hour(existingSlot.start_datetime);
      const slotEndTime = this.formatTime24Hour(existingSlot.end_datetime);
      const timeRangeKey = `${slotStartTime}-${slotEndTime}`;

      // ✅ NEW: Check for holiday conflicts
      const isHoliday = this.isDayRestricted(restrictions, targetDate);

      // ✅ NEW: Check for break conflicts
      const { isBreak, breakInfo } = this.isTimeInBreak(
        restrictions,
        targetDate,
        slotStartTime,
        slotEndTime,
      );

      if (isHoliday && existingSlot.order_id) {
        // ✅ NEW: Existing booking on holiday day - show both statuses
        enhancedSlots.push({
          ...existingSlot,
          type: 'HOLIDAY',
          is_available: false,
          is_blocked: true,
          status: ['HOLIDAY', 'BOOKED'], // ✅ Status array
          description: 'Holiday day but has existing booking',
        });
        processedTimeRanges.add(timeRangeKey);
      } else if (isBreak && breakInfo && existingSlot.order_id) {
        // ✅ NEW: Existing booking during break time - show both statuses
        enhancedSlots.push({
          ...existingSlot,
          type: 'BREAK',
          is_available: false,
          is_blocked: true,
          status: ['BREAK', 'BOOKED'], // ✅ Status array
          description: 'Break time but has existing booking',
        });
        processedTimeRanges.add(timeRangeKey);
      } else if (isBreak && breakInfo) {
        // ✅ NEW: Existing slot conflicts with break (no booking)
        enhancedSlots.push({
          ...existingSlot,
          type: 'BREAK',
          is_available: false,
          is_blocked: true,
          status: ['BREAK'], // ✅ Status array
          description: breakInfo.description || 'Break Time',
        });
        processedTimeRanges.add(timeRangeKey);
      } else {
        // ✅ NEW: Process as normal slot with status array
        enhancedSlots.push({
          ...existingSlot,
          status: this.getSlotStatus(existingSlot), // ✅ Status array
        });
        processedTimeRanges.add(timeRangeKey);
      }
    }

    // Step 2: Add template slots that don't overlap with existing slots
    for (const templateSlot of potentialSlots) {
      const slotStartTime = this.formatTime24Hour(templateSlot.start_datetime);
      const slotEndTime = this.formatTime24Hour(templateSlot.end_datetime);
      const timeRangeKey = `${slotStartTime}-${slotEndTime}`;

      // Skip if this time range has already been processed
      if (processedTimeRanges.has(timeRangeKey)) {
        continue;
      }

      // ✅ FIXED: Check for overlap with existing slots using proper overlap detection
      const hasOverlappingSlot = existingSlots.some((existing) => {
        return this.slotsOverlap(templateSlot, existing);
      });

      if (!hasOverlappingSlot) {
        // Check for break time
        const { isBreak, breakInfo } = this.isTimeInBreak(
          restrictions,
          targetDate,
          slotStartTime,
          slotEndTime,
        );

        if (isBreak && breakInfo) {
          enhancedSlots.push({
            ...templateSlot,
            type: 'BREAK',
            is_available: false,
            is_blocked: true,
            status: ['BREAK'], // ✅ Status array
            description: breakInfo.description || 'Break Time',
          });
        } else {
          enhancedSlots.push({
            ...templateSlot,
            type: 'BOOKABLE',
            is_available: true,
            is_blocked: false,
            status: ['AVAILABLE'], // ✅ Status array
          });
        }
        processedTimeRanges.add(timeRangeKey);
      }
    }

    // ✅ FIXED: Ensure break slots are properly included even if not in template
    const dayOfWeek = targetDate.getDay();
    for (const restriction of restrictions) {
      if (
        restriction.type === 'BREAK' &&
        Array.isArray(restriction.day_of_week) &&
        restriction.day_of_week.includes(dayOfWeek) &&
        restriction.start_time &&
        restriction.end_time
      ) {
        const breakStartTime = restriction.start_time;
        const breakEndTime = restriction.end_time;
        const breakTimeRangeKey = `${breakStartTime}-${breakEndTime}`;

        // Check if break slot already exists
        const breakExists = enhancedSlots.some((slot) => {
          if (slot.type === 'BREAK') {
            const slotStart = this.formatTime24Hour(slot.start_datetime);
            const slotEnd = this.formatTime24Hour(slot.end_datetime);
            return slotStart === breakStartTime && slotEnd === breakEndTime;
          }
          return false;
        });

        if (!breakExists && !processedTimeRanges.has(breakTimeRangeKey)) {
          // Create break slot
          const breakStart = new Date(targetDate);
          const [breakStartHour, breakStartMinute] = breakStartTime
            .split(':')
            .map(Number);
          breakStart.setHours(breakStartHour, breakStartMinute, 0, 0);

          const breakEnd = new Date(targetDate);
          const [breakEndHour, breakEndMinute] = breakEndTime
            .split(':')
            .map(Number);
          breakEnd.setHours(breakEndHour, breakEndMinute, 0, 0);

          enhancedSlots.push({
            garage_id: garageId,
            start_datetime: breakStart,
            end_datetime: breakEnd,
            type: 'BREAK',
            is_available: false,
            is_blocked: true,
            status: ['BREAK'], // ✅ Status array
            description: restriction.description || 'Break Time',
          });
          processedTimeRanges.add(breakTimeRangeKey);
        }
      }
    }

    // ✅ FIXED: Sort slots by start time
    enhancedSlots.sort(
      (a, b) =>
        new Date(a.start_datetime).getTime() -
        new Date(b.start_datetime).getTime(),
    );

    // ✅ ENHANCED: Format slots with status array support
    const cleanSlots = enhancedSlots.map((slot) =>
      this.formatSlotForDisplay(slot),
    );

    // ✅ ENHANCED: Calculate enhanced summary with status array support
    const summary = this.calculateEnhancedSummary(enhancedSlots);


    return {
      success: true,
      data: {
        garage_id: garageId,
        date,
        working_hours: {
          start: schedule.start_time,
          end: schedule.end_time,
        },
        slots: cleanSlots,
        summary,
      },
    };
  }

  // ✅ FIXED: Enhanced slot generation with proper break handling
  private generateSlotsForDay(
    startTime: string,
    endTime: string,
    slotDuration: number,
    date: Date,
    garageId: string,
    restrictions: RestrictionDto[] = [],
    existingDatabaseSlots: any[] = [], // NEW: pass DB slots to avoid generating conflicting templates
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

      // Skip if overlaps with a DB slot
      const isOccupiedByDatabase = existingDatabaseSlots.some((dbSlot) => {
        return this.slotsOverlap(
          { start_datetime: slotStart, end_datetime: slotEnd },
          dbSlot,
        );
      });

      if (!isOccupiedByDatabase) {
        // Check break
        const slotStartTime = this.formatTime24Hour(slotStart);
        const slotEndTime = this.formatTime24Hour(slotEnd);
        const { isBreak } = this.isTimeInBreak(
          restrictions,
          date,
          slotStartTime,
          slotEndTime,
        );

        if (!isBreak) {
          slots.push({
            garage_id: garageId,
            start_datetime: slotStart,
            end_datetime: slotEnd,
            is_available: true,
            is_blocked: false,
          });
        }
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
    const holidays = generateHolidaysForMonth(restrictions, year, month);

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

  // ✅ NEW: Enhanced calendar view with week calculation
  async getCalendarView(
    garageId: string,
    year: number,
    month: number,
    weekNumber?: number,
  ) {
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
          month_name: getMonthName(month),
          current_week: {
            week_number: 1,
            is_current_month: false,
            today_date: new Date().toISOString().split('T')[0],
          },
          week_schedule: {
            week_number: 1,
            start_date: new Date(year, month - 1, 1)
              .toISOString()
              .split('T')[0],
            end_date: new Date(year, month - 1, 7).toISOString().split('T')[0],
            days: [],
          },
          month_holidays: [],
        },
      };
    }

    // 2. Parse restrictions
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    // 3. Calculate current week info
    const currentWeekInfo: CurrentWeekInfo = getCurrentWeekInfo(year, month);

    // 4. Determine which week to show
    let targetWeekNumber: number;
    if (weekNumber !== undefined) {
      // Validate provided week number
      if (!validateWeekNumber(weekNumber, year, month)) {
        throw new BadRequestException(
          `Invalid week number: ${weekNumber} for ${getMonthName(month)} ${year}`,
        );
      }
      targetWeekNumber = weekNumber;
    } else {
      // Use current week
      targetWeekNumber = currentWeekInfo.weekNumber;
    }

    // 5. Calculate week date range
    const weekDateRange: WeekDateRange = getWeekDateRange(
      year,
      month,
      targetWeekNumber,
    );

    // 6. Generate week schedule
    const weekDays = generateWeekSchedule(
      weekDateRange.start,
      weekDateRange.end,
      schedule,
      restrictions,
      currentWeekInfo.todayDate,
    );

    // 7. Generate holidays for the month
    const monthHolidays = generateHolidaysForMonth(restrictions, year, month);

    // 8. Format response
    return {
      success: true,
      data: {
        year,
        month,
        month_name: getMonthName(month),

        // Current week info (backend calculated)
        current_week: {
          week_number: currentWeekInfo.weekNumber,
          is_current_month: currentWeekInfo.isCurrentMonth,
          today_date: currentWeekInfo.todayDate,
        },

        // Week schedule for left panel
        week_schedule: {
          week_number: targetWeekNumber,
          start_date: weekDateRange.start.toISOString().split('T')[0],
          end_date: weekDateRange.end.toISOString().split('T')[0],
          days: weekDays,
        },

        // Holidays for right panel (calendar)
        month_holidays: monthHolidays,
      },
    };
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

  // Add these helper methods
  private getBreakInfo(
    restrictions: any[],
    dayOfWeek: number,
    slotStartTime: string,
  ) {
    const breakRestriction = restrictions.find(
      (r) =>
        r.type === 'BREAK' &&
        r.day_of_week?.includes(dayOfWeek) &&
        r.start_time === slotStartTime,
    );

    return {
      description: breakRestriction?.description || 'Break Time',
    };
  }

  // Add these helper methods at the class level
  private getLocalDateTime(date: string, time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hours, minutes, 0, 0);
    return dateTime;
  }

  private convertToUTC(localDate: Date): Date {
    return new Date(
      Date.UTC(
        localDate.getFullYear(),
        localDate.getMonth(),
        localDate.getDate(),
        localDate.getHours(),
        localDate.getMinutes(),
        0,
        0,
      ),
    );
  }

  private convertToLocal(utcDate: Date): Date {
    const localDate = new Date(utcDate);
    localDate.setMinutes(
      localDate.getMinutes() + localDate.getTimezoneOffset(),
    );
    return localDate;
  }

  private debugTimeRange(d: Date) {
    return `${this.formatTime24Hour(d)}`;
  }
  private debugSlotRange(s: { start_datetime: Date; end_datetime: Date }) {
    return `${this.debugTimeRange(s.start_datetime)}-${this.debugTimeRange(s.end_datetime)}`;
  }

  async modifySlotTime(
    garageId: string,
    dto: ModifySlotTimeDto,
  ): Promise<ModificationResult> {
    return await this.prisma.$transaction(async (tx) => {
      try {

        const schedule = await tx.schedule.findUnique({
          where: { garage_id: garageId },
        });
        if (!schedule || !schedule.is_active)
          throw new BadRequestException('No active schedule found.');



        const timeFields = [
          dto.current_time,
          dto.new_start_time,
          dto.new_end_time,
        ];
        for (const time of timeFields) {
          if (!this.isValidTimeFormat(time)) {
            throw new BadRequestException(
              `Invalid time format: ${time}. Use 24-hour HH:mm format.`,
            );
          }
        }

        const targetDate = new Date(dto.date);
        const [currentHour, currentMinute] = dto.current_time
          .split(':')
          .map(Number);
        const [newStartHour, newStartMinute] = dto.new_start_time
          .split(':')
          .map(Number);
        const [newEndHour, newEndMinute] = dto.new_end_time
          .split(':')
          .map(Number);

        const currentSlotTime = new Date(targetDate);
        currentSlotTime.setHours(currentHour, currentMinute, 0, 0);

        const newStartTime = new Date(targetDate);
        newStartTime.setHours(newStartHour, newStartMinute, 0, 0);

        const newEndTime = new Date(targetDate);
        newEndTime.setHours(newEndHour, newEndMinute, 0, 0);


        if (
          dto.new_start_time < schedule.start_time ||
          dto.new_end_time > schedule.end_time
        ) {
          throw new BadRequestException('New time is outside operating hours');
        }

        this.validateSlotDuration(
          dto.new_start_time,
          dto.new_end_time,
          schedule.slot_duration,
          true,
        );

        let existingSlot = await tx.timeSlot.findFirst({
          where: { garage_id: garageId, start_datetime: currentSlotTime },
        });

        if (!existingSlot) {
          existingSlot = await tx.timeSlot.create({
            data: {
              garage_id: garageId,
              start_datetime: currentSlotTime,
              end_datetime: newEndTime,
              is_available: true,
              is_blocked: false,
            },
          });
        } else if (existingSlot.order_id) {
          throw new BadRequestException('Cannot modify a booked slot');
        }

        

        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const overlappingSlots = await tx.timeSlot.findMany({
          where: {
            garage_id: garageId,
            id: { not: existingSlot.id },
            start_datetime: { gte: startOfDay, lte: endOfDay },
          },
        });

        

        const restrictions = Array.isArray(schedule.restrictions)
          ? schedule.restrictions
          : JSON.parse(schedule.restrictions as string);
        

        // Generate templates WITHOUT excluding DB here; we will check DB-first then use templates if needed
        const templateSlots = this.generateSlotsForDay(
          schedule.start_time,
          schedule.end_time,
          schedule.slot_duration,
          targetDate,
          garageId,
          restrictions,
          [], // do not filter by DB here; DB check is explicit and first-priority
        );

        

        const affectedSlots: Array<{
          id?: string;
          time: string;
          status: 'BOOKED' | 'AVAILABLE';
          source: 'DATABASE' | 'TEMPLATE';
        }> = [];

        // Include the current DB slot as an affected DB conflict if the new range differs
        if (
          existingSlot &&
          (existingSlot.start_datetime.getTime() !== newStartTime.getTime() ||
            existingSlot.end_datetime.getTime() !== newEndTime.getTime())
        ) {
          affectedSlots.push({
            id: existingSlot.id,
            time: `${this.formatTime24Hour(existingSlot.start_datetime)}-${this.formatTime24Hour(existingSlot.end_datetime)}`,
            status: existingSlot.order_id
              ? ('BOOKED' as const)
              : ('AVAILABLE' as const),
            source: 'DATABASE',
          });
        }

        // Always check TEMPLATE conflicts too, but skip templates that overlap the existing DB slot
        for (const templateSlot of templateSlots) {
          const overlapsNew = this.slotsOverlap(
            { start_datetime: newStartTime, end_datetime: newEndTime },
            templateSlot,
          );

          // Skip template 08:00-09:00 if it overlaps the existing DB 08:00-08:30 (avoid duplicate/confusing entry)
          const overlapsExistingDb =
            !!existingSlot && this.slotsOverlap(templateSlot, existingSlot);

          if (overlapsNew && !overlapsExistingDb) {
            affectedSlots.push({
              time: `${this.formatTime24Hour(templateSlot.start_datetime)}-${this.formatTime24Hour(templateSlot.end_datetime)}`,
              status: 'AVAILABLE' as const,
              source: 'TEMPLATE',
            });
          }
        }

        if (affectedSlots.length > 0) {
          const bookedSlots = affectedSlots.filter(
            (s) => s.status === 'BOOKED',
          );

          if (!dto.overlap) {
            
            return {
              success: false,
              warning: `This modification would affect existing slots: ${affectedSlots.map((s) => s.time).join(', ')}`,
              affected_slots: affectedSlots,
              message:
                'Modification rejected due to overlaps. Set overlap: true to proceed.',
              requires_confirmation: true,
            };
          }

          if (bookedSlots.length > 0) {
            throw new BadRequestException(
              `Cannot modify slot: would overlap with booked slots: ${bookedSlots.map((s) => s.time).join(', ')}`,
            );
          }

          const dbSlotsToDelete = affectedSlots
            .filter((s) => s.source === 'DATABASE' && s.id)
            .map((s) => s.id as string);

          

          if (dbSlotsToDelete.length > 0) {
            await tx.timeSlot.deleteMany({
              where: { id: { in: dbSlotsToDelete } },
            });
          }
        }

        const updatedSlot = await tx.timeSlot.update({
          where: { id: existingSlot.id },
          data: {
            start_datetime: newStartTime,
            end_datetime: newEndTime,
            modification_type: this.getModificationType('TIME_MODIFIED'),
            modification_reason: dto.reason || 'Time modified',
            modified_by: garageId,
            is_blocked: false,
            is_available: true,
          },
        });

        

        const formattedSlot = this.formatSlotForDisplay(updatedSlot);

        return {
          success: true,
          modifications: [
            {
              slot_id: updatedSlot.id,
              status: 'UPDATED',
              details: {
                original_time: {
                  start: dto.current_time,
                  end: this.formatTime24Hour(existingSlot.end_datetime),
                },
                new_time: {
                  start: dto.new_start_time,
                  end: dto.new_end_time,
                },
              },
            },
          ],
          affected_slots: affectedSlots.length > 0 ? affectedSlots : undefined,
          message: 'Slot time modified successfully',
        };
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof BadRequestException
        )
          throw error;
        throw new BadRequestException(
          'Failed to modify slot time. Please check your input and try again.',
        );
      }
    });
  }

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

    // Parse restrictions to ensure they're in the correct format
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);

    return {
      success: true,
      data: {
        ...schedule,
        restrictions, // Return parsed restrictions
      },
    };
  }
}
