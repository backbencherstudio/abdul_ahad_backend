import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class GetMotReportsQueryDto {
  @ApiProperty({
    required: false,
    description:
      'Comma-separated field names or predefined groups (basic, summary, detailed, full)',
    example: 'registration,make,model,test_number,status',
  })
  @IsOptional()
  @IsString()
  fields?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by MOT test status (e.g., PASSED, FAILED)',
    example: 'PASSED',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({
    required: false,
    default: true,
    description: 'Include defects in response',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_defects?: boolean = true;

  @ApiProperty({
    required: false,
    default: 10,
    minimum: 1,
    maximum: 100,
    description: 'Limit number of MOT reports returned',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiProperty({
    required: false,
    default: 1,
    minimum: 1,
    description: 'Page number for pagination',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Return full response (backward compatibility)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  full_response?: boolean = false;
}
