import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateSubscriptionPlanDto {
  @ApiProperty({
    description: 'Plan name (e.g., Basic, Premium, Enterprise)',
    example: 'Premium Plan',
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Plan description',
    example: 'Premium plan with advanced features and priority support',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Monthly price in pence (e.g., 2999 = £29.99)',
    example: 2999,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price_pence: number;

  @ApiProperty({
    description: 'Currency code',
    example: 'GBP',
    default: 'GBP',
  })
  @IsOptional()
  @IsString()
  currency?: string = 'GBP';

  @ApiProperty({
    description: 'Maximum number of bookings per month',
    example: 100,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  max_bookings_per_month: number;

  @ApiProperty({
    description: 'Maximum number of vehicles per garage',
    example: 50,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  max_vehicles: number;

  @ApiProperty({
    description: 'Whether plan includes priority support',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  priority_support?: boolean = false;

  @ApiProperty({
    description: 'Whether plan includes advanced analytics',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  advanced_analytics?: boolean = false;

  @ApiProperty({
    description: 'Whether plan includes custom branding',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  custom_branding?: boolean = false;

  @ApiProperty({
    description: 'Whether plan is active and available for subscription',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @ApiProperty({
    description: 'Stripe price ID for this plan',
    example: 'price_1234567890',
    required: false,
  })
  @IsOptional()
  @IsString()
  stripe_price_id?: string;

  @ApiProperty({
    description:
      'Trial period in days (0 = no trial, business controls trial length)',
    example: 14,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  trial_period_days?: number;
}
