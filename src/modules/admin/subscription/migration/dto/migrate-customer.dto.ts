import { IsNotEmpty } from 'class-validator';

export class MigrateCustomerDto {
  @IsNotEmpty()
  subscription_id: string;
}
