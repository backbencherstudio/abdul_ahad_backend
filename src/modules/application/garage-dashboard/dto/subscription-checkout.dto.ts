import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubscriptionCheckoutDto {
  @ApiProperty({
    description:
      'Plan ID to subscribe to (trial period is controlled by the plan)',
    example: 'cmfw1m6ni0000uaj4coeonlgs',
  })
  @IsNotEmpty()
  @IsString()
  plan_id: string;

  // Removed trial_period_days - now controlled by subscription plan
  // Business controls trial length per plan for better strategy and consistency
}

export class SubscriptionCheckoutResponseDto {
  @ApiProperty({ description: 'Stripe checkout URL' })
  checkout_url: string;

  @ApiProperty({ description: 'Stripe session ID' })
  session_id: string;
}
