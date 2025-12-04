import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum BookableServiceType {
  MOT = 'MOT',
  RETEST = 'RETEST',
}

export class BookSlotDto {
  @ApiProperty({
    description: 'Garage ID to book with',
    example: 'clx1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty({ message: 'Garage ID is required' })
  garage_id: string;

  @ApiProperty({
    description: 'Vehicle ID to book for',
    example: 'clx1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty({ message: 'Vehicle ID is required' })
  vehicle_id: string;

  @ApiPropertyOptional({
    description:
      'Time slot ID to book (optional - use for existing database slots)',
    example: 'clx1234567890abcdef',
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !o.date || !o.start_time || !o.end_time)
  @IsNotEmpty({
    message: 'Either slot_id OR (date, start_time, end_time) must be provided',
  })
  slot_id?: string;

  @ApiPropertyOptional({
    description:
      'Booking date (required for template slots, format: YYYY-MM-DD)',
    example: '2025-12-10',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format',
  })
  @ValidateIf((o) => !o.slot_id)
  @IsNotEmpty({
    message: 'Date is required when slot_id is not provided',
  })
  date?: string;

  @ApiPropertyOptional({
    description: 'Slot start time (required for template slots, format: HH:mm)',
    example: '09:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Start time must be in HH:mm format (24-hour)',
  })
  @ValidateIf((o) => !o.slot_id)
  @IsNotEmpty({
    message: 'Start time is required when slot_id is not provided',
  })
  start_time?: string;

  @ApiPropertyOptional({
    description: 'Slot end time (required for template slots, format: HH:mm)',
    example: '10:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'End time must be in HH:mm format (24-hour)',
  })
  @ValidateIf((o) => !o.slot_id)
  @IsNotEmpty({
    message: 'End time is required when slot_id is not provided',
  })
  end_time?: string;

  @ApiProperty({
    description: 'Service type to book (MOT or RETEST only)',
    enum: BookableServiceType,
    example: BookableServiceType.MOT,
  })
  @IsEnum(BookableServiceType, {
    message: 'Service type must be either MOT or RETEST',
  })
  service_type: BookableServiceType;
}
