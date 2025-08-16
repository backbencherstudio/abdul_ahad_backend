import { IsString, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ModifySlotTimeDto {
  @ApiProperty({ description: 'Date of the slot (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Current start time (HH:mm)' })
  @IsString()
  current_time: string;

  @ApiProperty({ description: 'New start time (HH:mm)' })
  @IsString()
  new_start_time: string;

  @ApiProperty({ description: 'New end time (HH:mm)' })
  @IsString()
  new_end_time: string;

  @ApiProperty({ description: 'Reason for modification', required: false })
  @IsString()
  @IsOptional()
  reason?: string;
}
