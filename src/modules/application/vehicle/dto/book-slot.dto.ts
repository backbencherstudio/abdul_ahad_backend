import { IsString, IsNotEmpty, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({
    description: 'Time slot ID to book',
    example: 'clx1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty({ message: 'Slot ID is required' })
  slot_id: string;

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
