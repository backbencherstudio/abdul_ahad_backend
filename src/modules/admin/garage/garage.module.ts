import { Module } from '@nestjs/common';
import { AbilityModule } from 'src/ability/ability.module';
import { GarageController } from './garage.controller';
import { GarageService } from './garage.service';

@Module({
  imports: [AbilityModule],
  controllers: [GarageController],
  providers: [GarageService],
  exports: [GarageService],
})
export class GarageModule {}
