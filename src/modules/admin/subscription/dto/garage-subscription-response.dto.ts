import { ApiProperty } from '@nestjs/swagger';

export class GarageSubscriptionResponseDto {
  @ApiProperty({ description: 'Subscription ID' })
  id: string;

  @ApiProperty({ description: 'Garage ID' })
  garage_id: string;

  @ApiProperty({ description: 'Garage name' })
  garage_name: string;

  @ApiProperty({ description: 'Garage email' })
  garage_email: string;

  @ApiProperty({ description: 'Plan ID' })
  plan_id: string;

  @ApiProperty({ description: 'Plan name' })
  plan_name: string;

  @ApiProperty({
    description: 'Subscription status',
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELLED', 'PAST_DUE'],
  })
  status: string;

  @ApiProperty({ description: 'Current period start date', required: false })
  current_period_start?: Date;

  @ApiProperty({ description: 'Current period end date', required: false })
  current_period_end?: Date;

  @ApiProperty({ description: 'Next billing date', required: false })
  next_billing_date?: Date;

  @ApiProperty({ description: 'Price in pence' })
  price_pence: number;

  @ApiProperty({ description: 'Formatted price string' })
  price_formatted: string;

  @ApiProperty({ description: 'Stripe subscription ID', required: false })
  stripe_subscription_id?: string;

  @ApiProperty({ description: 'Stripe customer ID', required: false })
  stripe_customer_id?: string;

  @ApiProperty({ description: 'Created at' })
  created_at: Date;

  @ApiProperty({ description: 'Updated at' })
  updated_at: Date;
}
