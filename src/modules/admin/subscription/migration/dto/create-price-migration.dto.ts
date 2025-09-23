import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreatePriceMigrationDto {
  @IsNotEmpty()
  plan_id: string;

  @IsNumber()
  @Min(1)
  new_price_pence: number;

  // optional in later steps; default 30
  notice_period_days?: number;
}
