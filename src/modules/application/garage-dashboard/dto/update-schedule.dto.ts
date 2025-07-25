import { IsOptional, IsString, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateScheduleDto {
  @ApiProperty({ description: 'Day of the week', required: false })
  @IsOptional()
  @IsNumber()
  day_of_week?: number;

  @ApiProperty({ description: 'Start time (HH:MM format)', required: false })
  @IsOptional()
  @IsString()
  start_time?: string;

  @ApiProperty({ description: 'End time (HH:MM format)', required: false })
  @IsOptional()
  @IsString()
  end_time?: string;

  @ApiProperty({ description: 'Is schedule active', required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ description: 'Slot duration', required: false })
  @IsOptional()
  @IsNumber()
  slot_duration?: number;
}
