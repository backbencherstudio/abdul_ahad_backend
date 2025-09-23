import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubscriptionCheckoutDto {
  @ApiProperty({
    description: 'Plan ID to subscribe to',
    example: 'cmfw1m6ni0000uaj4coeonlgs',
  })
  @IsNotEmpty()
  @IsString()
  plan_id: string;
}

export class SubscriptionCheckoutResponseDto {
  @ApiProperty({ description: 'Stripe checkout URL' })
  checkout_url: string;

  @ApiProperty({ description: 'Stripe session ID' })
  session_id: string;
}
