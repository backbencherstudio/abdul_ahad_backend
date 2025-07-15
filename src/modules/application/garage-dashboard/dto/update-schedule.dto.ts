import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateScheduleDto {
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
}
