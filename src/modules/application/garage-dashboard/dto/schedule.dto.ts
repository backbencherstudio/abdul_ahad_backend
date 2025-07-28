import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { CalendarEventType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ScheduleDto {
  @IsDateString()
  date: string; // "2025-07-20"

  @IsEnum(CalendarEventType)
  type: CalendarEventType;

  @IsOptional()
  @IsString()
  start_time?: string; // "09:00"

  @IsOptional()
  @IsString()
  end_time?: string; // "17:00"

  @IsOptional()
  @IsNumber()
  slot_duration?: number; // 30, 45, 60
}

export class WeeklyPatternDto {
  @IsNumber()
  day_of_week: number; // 0-6

  @IsEnum(CalendarEventType)
  type: CalendarEventType;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;

  @IsOptional()
  @IsNumber()
  slot_duration?: number;
}

export class SetWeeklyPatternDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeeklyPatternDto)
  pattern: WeeklyPatternDto[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  @ApiProperty({
    description: 'Number of days to generate slots for (1-365)',
    example: 90,
    default: 90,
  })
  daysToGenerate?: number = 90; // Default fallback
}
