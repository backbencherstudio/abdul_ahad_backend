import { PartialType } from '@nestjs/swagger';
import { CreateGarageDto } from './create-garage.dto';

export class UpdateGarageDto extends PartialType(CreateGarageDto) {}
