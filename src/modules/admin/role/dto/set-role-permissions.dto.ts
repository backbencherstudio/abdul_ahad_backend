import { ArrayNotEmpty, IsArray, IsIn, IsString } from 'class-validator';

export class SetRolePermissionsDto {
  @IsIn(['assign', 'replace', 'remove'])
  mode: 'assign' | 'replace' | 'remove';

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permission_ids: string[];
}
