import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserRole, ServiceType } from '@prisma/client';
import { GarageDto } from './dto/garage-search-response.dto';
import {
  AdditionalServiceDto,
  BookableServiceDto,
  GarageServicesResponseDto,
} from './dto/garage-services.dto';

@Injectable()
export class VehicleGarageService {
  private readonly logger = new Logger(VehicleGarageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find active garages by postcode
   * Only returns garages that are active and have subscription
   */
  async findActiveGarages(postcode: string): Promise<GarageDto[]> {
    try {
      this.logger.log(
        `Searching for active garages near postcode: ${postcode}`,
      );

      // Extract postcode prefix for broader search (e.g., "M1" from "M1 1AA")
      const postcodePrefix = postcode.split(' ')[0].toUpperCase();

      const garages = await this.prisma.user.findMany({
        where: {
          type: UserRole.GARAGE,
          status: 1, // Active status
          // Note: Add subscription check when implemented
          // subscription_active: true,
          zip_code: {
            startsWith: postcodePrefix,
          },
        },
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          vts_number: true,
          primary_contact: true,
          phone_number: true,
        },
        orderBy: {
          garage_name: 'asc',
        },
      });

      this.logger.log(`Found ${garages.length} active garages`);

      // Transform to DTO format
      const garageDtos: GarageDto[] = garages.map((garage) => ({
        id: garage.id,
        garage_name: garage.garage_name || 'Unnamed Garage',
        address: garage.address || 'Address not provided',
        postcode: garage.zip_code || '',
        vts_number: garage.vts_number || 'VTS not provided',
        primary_contact: garage.primary_contact || 'Contact not provided',
        phone_number: garage.phone_number || 'Phone not provided',
        // TODO: Calculate distance when postcode service is implemented
        distance_miles: undefined,
      }));

      return garageDtos;
    } catch (error) {
      this.logger.error(`Error finding active garages: ${error.message}`);
      throw new BadRequestException('Failed to search for garages');
    }
  }

  /**
   * Get garage services separated into bookable and additional
   */
  async getGarageServices(garageId: string): Promise<any> {
    try {
      this.logger.log(`Fetching services for garage: ${garageId}`);

      // Verify garage exists and is active
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
      });

      if (!garage) {
        throw new NotFoundException('Garage not found or inactive');
      }

      // Fetch all services for the garage
      const services = await this.prisma.service.findMany({
        where: {
          garage_id: garageId,
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });

      // Separate services into bookable and additional
      const bookableServices: BookableServiceDto[] = [];
      const additionalServices: AdditionalServiceDto[] = [];

      services.forEach((service) => {
        if (
          service.type === ServiceType.MOT ||
          service.type === ServiceType.RETEST
        ) {
          // Bookable services (MOT and Retest)
          bookableServices.push({
            id: service.id,
            name: service.name,
            type: service.type as 'MOT' | 'RETEST',
            price: Number(service.price) || 0,
          });
        } else if (service.type === ServiceType.ADDITIONAL) {
          // Additional services (showcase only)
          additionalServices.push({
            id: service.id,
            name: service.name,
            type: 'ADDITIONAL',
          });
        }
      });

      this.logger.log(
        `Found ${bookableServices.length} bookable services and ${additionalServices.length} additional services`,
      );

      return {
        garage: {
          id: garage.id,
          garage_name: garage.garage_name,
          address: garage.address,
          zip_code: garage.zip_code,
          vts_number: garage.vts_number,
          primary_contact: garage.primary_contact,
          phone_number: garage.phone_number,
        },
        services: bookableServices,
        additionals: additionalServices,
      };
    } catch (error) {
      this.logger.error(`Error fetching garage services: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch garage services');
    }
  }

  /**
   * Validate if a garage can accept bookings
   */
  async validateGarageAvailability(garageId: string): Promise<boolean> {
    try {
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
        select: {
          id: true,
          // Add subscription check when implemented
          // subscription_active: true,
        },
      });

      return !!garage;
    } catch (error) {
      this.logger.error(
        `Error validating garage availability: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get garage details by ID
   */
  async getGarageById(garageId: string): Promise<GarageDto | null> {
    try {
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          vts_number: true,
          primary_contact: true,
          phone_number: true,
        },
      });

      if (!garage) {
        return null;
      }

      return {
        id: garage.id,
        garage_name: garage.garage_name || 'Unnamed Garage',
        address: garage.address || 'Address not provided',
        postcode: garage.zip_code || '',
        vts_number: garage.vts_number || 'VTS not provided',
        primary_contact: garage.primary_contact || 'Contact not provided',
        phone_number: garage.phone_number || 'Phone not provided',
        distance_miles: undefined,
      };
    } catch (error) {
      this.logger.error(`Error fetching garage details: ${error.message}`);
      return null;
    }
  }
}
