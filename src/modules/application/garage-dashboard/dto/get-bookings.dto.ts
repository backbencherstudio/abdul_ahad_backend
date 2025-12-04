import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum BookingStatusFilter {
  ALL = 'ALL',
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class GetBookingsDto {
  @ApiPropertyOptional({
    description:
      'Search term for vehicle registration, driver name, or driver email',
    example: 'AB12CDE',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by booking status',
    enum: BookingStatusFilter,
    example: BookingStatusFilter.ALL,
    default: BookingStatusFilter.ALL,
  })
  @IsOptional()
  @IsEnum(BookingStatusFilter)
  status?: BookingStatusFilter = BookingStatusFilter.ALL;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
