import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { CalendarEventType } from '@prisma/client';

export class CreateCalendarDto {
  @IsDateString()
  event_date: string; // "2025-07-17"

  @IsEnum(CalendarEventType)
  type: CalendarEventType; // "HOLIDAY", "OPEN", "CLOSED"

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  start_time?: string; // e.g. "10:00AM"

  @IsOptional()
  @IsString()
  end_time?: string; // e.g. "6:00PM"
}
