import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionPlanResponseDto {
  @ApiProperty({ description: 'Plan ID' })
  id: string;

  @ApiProperty({ description: 'Plan name' })
  name: string;

  @ApiProperty({ description: 'Plan description', required: false })
  description?: string;

  @ApiProperty({ description: 'Monthly price in pence' })
  price_pence: number;

  @ApiProperty({ description: 'Formatted price (e.g., £29.99)' })
  price_formatted: string;

  @ApiProperty({ description: 'Currency code' })
  currency: string;

  @ApiProperty({ description: 'Maximum bookings per month' })
  max_bookings_per_month: number;

  @ApiProperty({ description: 'Maximum vehicles per garage' })
  max_vehicles: number;

  @ApiProperty({ description: 'Priority support included' })
  priority_support: boolean;

  @ApiProperty({ description: 'Advanced analytics included' })
  advanced_analytics: boolean;

  @ApiProperty({ description: 'Custom branding included' })
  custom_branding: boolean;

  @ApiProperty({ description: 'Plan is active' })
  is_active: boolean;

  @ApiProperty({ description: 'Trial period in days', example: 14 })
  trial_period_days: number;

  @ApiProperty({
    description: 'List of features included in this plan',
    example: [
      'Unlimited opportunity to receive MOT bookings — 24/7',
      "Boost Your Garage's Visibility",
      'Opportunity to upsell and offer extra services!',
    ],
    type: [String],
  })
  features: string[];

  @ApiProperty({ description: 'Stripe price ID', required: false })
  stripe_price_id?: string;

  @ApiProperty({
    description: 'Number of active subscriptions using this plan',
    example: 5,
  })
  active_subscriptions_count?: number;

  @ApiProperty({ description: 'Created at' })
  created_at: Date;

  @ApiProperty({ description: 'Updated at' })
  updated_at: Date;
}
