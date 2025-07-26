import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class ManualSlotDto {
  @IsString()
  date: string; // "2025-07-20"

  @IsArray()
  slots: {
    start_time: string; // "HH:mm"
    end_time: string; // "HH:mm"
  }[];

  @IsOptional()
  @IsBoolean()
  replace?: boolean; // Optional: if true, replace all slots for the date
}
