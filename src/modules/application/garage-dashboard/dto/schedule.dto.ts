import {
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  IsOptional,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// NEW: Define restriction types
export type RestrictionType = 'HOLIDAY' | 'BREAK';

export class RestrictionDto {
  @ApiProperty({ description: 'Restriction type', enum: ['HOLIDAY', 'BREAK'] })
  @IsEnum(['HOLIDAY', 'BREAK'])
  type: RestrictionType;

  @ApiProperty({
    description: 'Whether restriction is recurring',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @ApiProperty({ description: 'Day of week (0-6)', required: false })
  @IsOptional()
  @IsNumber()
  day_of_week?: number;

  @ApiProperty({ description: 'Month (1-12)', required: false })
  @IsOptional()
  @IsNumber()
  month?: number;

  @ApiProperty({ description: 'Day of month (1-31)', required: false })
  @IsOptional()
  @IsNumber()
  day?: number;

  @ApiProperty({ description: 'Start time for BREAK type', required: false })
  @IsOptional()
  @IsString()
  start_time?: string;

  @ApiProperty({ description: 'End time for BREAK type', required: false })
  @IsOptional()
  @IsString()
  end_time?: string;

  @ApiProperty({ description: 'Restriction description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

// NEW: Lightweight DTOs for daily hours (optional)
export class DailyIntervalDto {
  @ApiProperty({ description: 'Start time in HH:mm', example: '09:00' })
  @IsString()
  start_time: string;

  @ApiProperty({ description: 'End time in HH:mm', example: '18:00' })
  @IsString()
  end_time: string;
}

export class DailyHoursDayDto {
  @ApiPropertyOptional({ description: 'If true, the day is fully closed' })
  @IsOptional()
  @IsBoolean()
  is_closed?: boolean;

  @ApiPropertyOptional({
    description: 'List of open intervals for the day',
    type: [DailyIntervalDto],
  })
  @IsOptional()
  @IsArray()
  intervals?: DailyIntervalDto[];

  @ApiPropertyOptional({
    description: 'Optional per-day slot duration (minutes)',
    example: 45,
  })
  @IsOptional()
  @IsNumber()
  slot_duration?: number;
}

// We keep this as a plain record to avoid breaking validation; deeper checks in service
export type DailyHoursDto = Record<string, DailyHoursDayDto>;

export class ScheduleDto {
  @ApiProperty({ description: 'Start time in HH:mm format', example: '08:00' })
  @IsString()
  start_time: string;

  @ApiProperty({ description: 'End time in HH:mm format', example: '18:00' })
  @IsString()
  end_time: string;

  @ApiProperty({ description: 'Slot duration in minutes', example: 60 })
  @IsNumber()
  @Min(15)
  @Max(480) // 8 hours max
  slot_duration: number;

  @ApiProperty({ description: 'Whether schedule is active', example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ description: 'Schedule restrictions', type: [RestrictionDto] })
  @IsOptional()
  @IsArray()
  restrictions?: RestrictionDto[];

  // NEW: Optional per-day hours; if absent, global start/end apply
  @ApiPropertyOptional({
    description:
      'Per-day hours (keys: "0"-"6"). Example: {"0":{"is_closed":true},"1":{"intervals":[{"start_time":"09:00","end_time":"18:00"}]},"2":{"intervals":[{"start_time":"08:00","end_time":"12:00"},{"start_time":"13:00","end_time":"17:00"}],"slot_duration":45}}',
    type: 'object',
  })
  @IsOptional()
  daily_hours?: DailyHoursDto;
}

export class WeeklyPatternDto {
  @ApiProperty({ description: 'Day of week (0-6)', example: 1 })
  @IsNumber()
  day_of_week: number;

  @ApiProperty({ description: 'Day type', enum: ['OPEN', 'HOLIDAY', 'CLOSED'] })
  @IsEnum(['OPEN', 'HOLIDAY', 'CLOSED'])
  type: 'OPEN' | 'HOLIDAY' | 'CLOSED';

  @ApiProperty({ description: 'Start time', required: false })
  @IsOptional()
  @IsString()
  start_time?: string;

  @ApiProperty({ description: 'End time', required: false })
  @IsOptional()
  @IsString()
  end_time?: string;

  @ApiProperty({ description: 'Slot duration', required: false })
  @IsOptional()
  @IsNumber()
  slot_duration?: number;

  @ApiProperty({ description: 'Description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class SetWeeklyPatternDto {
  @ApiProperty({
    description: 'Weekly pattern for each day',
    type: [WeeklyPatternDto],
  })
  @IsArray()
  pattern: WeeklyPatternDto[];

  @ApiProperty({
    description: 'Number of days to generate slots for',
    example: 90,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  daysToGenerate?: number;
}

// src/modules/application/garage-dashboard/dto/schedule.dto.ts

export interface RestrictionDto {
  type: 'HOLIDAY' | 'BREAK';
  date?: string;
  is_recurring?: boolean;
  day_of_week?: number;
  month?: number;
  day?: number;
  start_time?: string;
  end_time?: string;
  description?: string;
}
