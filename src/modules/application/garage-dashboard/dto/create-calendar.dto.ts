import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { CalendarEventType } from '@prisma/client';

export class CreateCalendarDto {
  @IsDateString()
  event_date: string; // "2025-07-17"

  @IsEnum(CalendarEventType)
  type: CalendarEventType; // "HOLIDAY"

  @IsOptional()
  @IsString()
  description?: string;
}
