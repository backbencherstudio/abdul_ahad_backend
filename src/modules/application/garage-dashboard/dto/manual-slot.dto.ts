import {
  IsString,
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SlotDto {
  @ApiProperty({ description: 'Start time in HH:mm format', example: '09:00' })
  @IsString()
  start_time: string;

  @ApiProperty({ description: 'End time in HH:mm format', example: '10:00' })
  @IsString()
  end_time: string;
}

export class ManualSlotDto {
  @ApiProperty({
    description: 'Date in YYYY-MM-DD format',
    example: '2025-01-15',
  })
  @IsString()
  date: string;

  @ApiProperty({ description: 'Array of time slots', type: [SlotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];

  @ApiProperty({
    description: 'Whether to replace existing slots',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
