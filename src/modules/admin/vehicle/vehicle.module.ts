import { Module } from '@nestjs/common';
import { VehicleController } from './vehicle.controller';
import { VehicleService } from './vehicle.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AbilityModule } from 'src/ability/ability.module';

@Module({
  imports: [PrismaModule, AbilityModule],
  controllers: [VehicleController],
  providers: [VehicleService],
})
export class VehicleModule {}
