import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum GarageSubscriptionAction {
  ACTIVATE = 'ACTIVATE',
  SUSPEND = 'SUSPEND',
  CANCEL = 'CANCEL',
  REACTIVATE = 'REACTIVATE',
}

export class UpdateGarageSubscriptionDto {
  @ApiProperty({
    description: 'Action to perform on the subscription',
    enum: GarageSubscriptionAction,
    example: GarageSubscriptionAction.ACTIVATE,
  })
  @IsEnum(GarageSubscriptionAction)
  action: GarageSubscriptionAction;

  @ApiProperty({
    description: 'Optional reason for the action',
    required: false,
    example: 'Admin initiated activation',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
