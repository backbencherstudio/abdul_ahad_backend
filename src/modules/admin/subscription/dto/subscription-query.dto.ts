import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  PAST_DUE = 'PAST_DUE',
}

export class SubscriptionQueryDto {
  @ApiProperty({
    description: 'Page number',
    example: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
    required: false,
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20;

  @ApiProperty({
    description: 'Filter by subscription status',
    enum: SubscriptionStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiProperty({
    description: 'Filter by plan ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  plan_id?: string;

  @ApiProperty({
    description: 'Search by garage name or email',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Filter subscriptions created after this date',
    example: '2025-01-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  created_after?: string;

  @ApiProperty({
    description: 'Filter subscriptions created before this date',
    example: '2025-12-31',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  created_before?: string;
}
