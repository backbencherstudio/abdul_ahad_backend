import { IsString, Length } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @Length(1, 10)
  registration_number: string;
}
