import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'name must be lowercase alphanumeric with underscores',
  })
  name: string;
}
