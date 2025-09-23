import { ApiProperty } from '@nestjs/swagger';

export class PlanInfoDto {
  @ApiProperty({ description: 'Plan ID' })
  id: string;

  @ApiProperty({ description: 'Plan name' })
  name: string;

  @ApiProperty({ description: 'Formatted price string' })
  price_formatted: string;
}

export class CurrentSubscriptionResponseDto {
  @ApiProperty({ description: 'Subscription ID' })
  id: string;

  @ApiProperty({ description: 'Plan information', type: PlanInfoDto })
  plan: PlanInfoDto;

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

  @ApiProperty({ description: 'Can cancel subscription' })
  can_cancel: boolean;

  @ApiProperty({ description: 'Subscription creation date' })
  created_at: Date;
}
