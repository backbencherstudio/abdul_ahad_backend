import { IsInt, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateScheduleDto {
  day_of_week: number; // 0=Sunday, ..., 6=Saturday

  @IsBoolean()
  is_active: boolean;

  @IsOptional()
  @IsString()
  start_time?: string; // "10:00"

  @IsOptional()
  @IsString()
  end_time?: string; // "18:00"

  @IsOptional()
  slot_duration?: number; // <-- Ensure this is present and optional
}
