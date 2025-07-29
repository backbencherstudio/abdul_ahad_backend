import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export enum BookingStatus {
  ALL = 'all',
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export class GetMyBookingsDto {
  @ApiProperty({
    enum: BookingStatus,
    required: false,
    default: BookingStatus.ALL,
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus = BookingStatus.ALL;

  @ApiProperty({
    required: false,
    description: 'Search by garage, location, or registration',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class BookingDto {
  @ApiProperty() order_id: string;
  @ApiProperty() garage_name: string;
  @ApiProperty() location: string;
  @ApiProperty() email: string;
  @ApiProperty() phone_number: string;
  @ApiProperty() booking_date: string;
  @ApiProperty() total_amount: string;
  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REJECTED'] }) status: string;
  @ApiProperty() vehicle_registration: string;
  @ApiProperty({ enum: ['MOT', 'RETEST'] }) service_type: string;
}

export class MyBookingsResponseDto {
  @ApiProperty({ type: [BookingDto] }) bookings: BookingDto[];
  @ApiProperty({
    example: {
      total_count: 25,
      total_pages: 3,
      current_page: 1,
      limit: 10,
      has_next: true,
      has_prev: false,
    },
  })
  pagination: {
    total_count: number;
    total_pages: number;
    current_page: number;
    limit: number;
    has_next: boolean;
    has_prev: boolean;
  };
  @ApiProperty({
    example: { status: 'all', search: 'premium' },
  })
  filters: {
    status: string;
    search?: string;
  };
}
