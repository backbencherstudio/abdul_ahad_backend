import { ApiProperty } from '@nestjs/swagger';

export class BillingPortalResponseDto {
  @ApiProperty({ description: 'Stripe billing portal URL' })
  url: string;
}

export class CancelSubscriptionDto {
  @ApiProperty({
    description: 'Cancellation reason',
    required: false,
    example: 'Switching to different plan',
  })
  reason?: string;

  @ApiProperty({
    description: 'Cancel immediately or at period end',
    enum: ['immediate', 'at_period_end'],
    default: 'at_period_end',
  })
  cancel_type: 'immediate' | 'at_period_end' = 'at_period_end';
}

export class CancelSubscriptionResponseDto {
  @ApiProperty({ description: 'Success status' })
  success: boolean;

  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Cancellation effective date' })
  effective_date: Date;

  @ApiProperty({ description: 'Whether subscription is cancelled immediately' })
  cancelled_immediately: boolean;
}
