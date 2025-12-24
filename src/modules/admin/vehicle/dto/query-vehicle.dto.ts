import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export enum VehicleExpiryStatus {
  ALL = 'all',
  EXPIRED = 'expired',
  EXPIRED_SOON = 'expired_soon',
  NOT_EXPIRED = 'not_expired',
}

export class GetAllQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsNumber()
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 10))
  @IsNumber()
  limit: number = 10;

  @IsOptional()
  @IsEnum(VehicleExpiryStatus)
  expiry_status?: VehicleExpiryStatus;

  @IsOptional()
  @IsString()
  search: string;

  @IsOptional()
  @IsDateString()
  startdate: Date;

  @IsOptional()
  @IsDateString()
  enddate: Date;

  @IsOptional()
  @IsString()
  sort_by_expiry: string;
}
