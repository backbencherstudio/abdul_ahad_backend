import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateNotificationDto {}
export class CreateBulkNotificationDto {
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReceiverDto)
  receivers: ReceiverDto[];

  @IsString()
  @IsNotEmpty()
  message: string;
}

export class ReceiverDto {
  @IsString()
  @IsOptional()
  entity_id?: string;

  @IsString()
  @IsNotEmpty()
  receiver_id: string;
}
