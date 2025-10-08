import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

export class SubscriptionCheckoutDto {
  @ApiProperty({
    description: 'Plan ID to subscribe to',
    example: 'cmfw1m6ni0000uaj4coeonlgs',
  })
  @IsNotEmpty()
  @IsString()
  plan_id: string;

  @ApiProperty({
    description: 'Trial period in days (0 = no trial, defaults to 14 days)',
    example: 14,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  trial_period_days?: number;
}

export class SubscriptionCheckoutResponseDto {
  @ApiProperty({ description: 'Stripe checkout URL' })
  checkout_url: string;

  @ApiProperty({ description: 'Stripe session ID' })
  session_id: string;
}
