import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { VehicleService } from './vehicle.service';
import { VehicleController } from './vehicle.controller';
import { VehicleGarageService } from './vehicle-garage.service';
import { VehicleBookingService } from './vehicle-booking.service';
import { GarageDashboardModule } from '../garage-dashboard/garage-dashboard.module';

@Module({
  imports: [PrismaModule, GarageDashboardModule],
  providers: [VehicleService, VehicleGarageService, VehicleBookingService],
  controllers: [VehicleController],
  exports: [VehicleService, VehicleGarageService, VehicleBookingService],
})
export class VehicleModule {}
