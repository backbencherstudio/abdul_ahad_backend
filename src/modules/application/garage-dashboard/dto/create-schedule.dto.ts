import { IsNumber, IsString, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScheduleDto {
  @ApiProperty({ description: 'Day of week (0=Sunday, 6=Saturday)' })
  @IsNumber()
  @Min(0)
  @Max(6)
  day_of_week: number;

  @ApiProperty({ description: 'Start time (HH:MM format)' })
  @IsString()
  start_time: string;

  @ApiProperty({ description: 'End time (HH:MM format)' })
  @IsString()
  end_time: string;

  @ApiProperty({ description: 'Is schedule active' })
  @IsBoolean()
  is_active: boolean;
}
