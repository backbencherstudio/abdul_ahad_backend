import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import {
  DvlaService,
  CombinedVehicleData,
} from 'src/common/lib/DVLA/DvlaService';

/**
 * Vehicle Service for managing driver vehicles
 *
 * This service handles:
 * - Adding vehicles with DVLA/MOT API validation
 * - Retrieving vehicle information
 * - Managing vehicle profiles for drivers
 * - Integration with external DVLA and MOT APIs
 */
@Injectable()
export class VehicleService {
  private readonly logger = new Logger(VehicleService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Add a new vehicle for a driver with comprehensive validation
   *
   * @param userId - ID of the driver adding the vehicle
   * @param dto - Vehicle creation data (registration number)
   * @returns Promise<Vehicle> - Created vehicle with complete information
   */
  async addVehicle(userId: string, dto: CreateVehicleDto) {
    try {
      this.logger.log(
        `Adding vehicle for user ${userId}: ${dto.registration_number}`,
      );

      // Validate user exists and is a driver
      const user = await this.validateUserAndRole(userId, 'DRIVER');

      // Check if vehicle already exists for this user
      const existingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          user_id: userId,
          registration_number: dto.registration_number.toUpperCase(),
        },
      });

      if (existingVehicle) {
        throw new ConflictException(
          `Vehicle with registration ${dto.registration_number} already exists for this user`,
        );
      }

      // Check if vehicle exists globally (another user might have it)
      const globalExistingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          registration_number: dto.registration_number.toUpperCase(),
          user_id: { not: userId }, // Different user
        },
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      });

      if (globalExistingVehicle) {
        this.logger.warn(
          `Vehicle ${dto.registration_number} already registered by another user: ${globalExistingVehicle.user.email}`,
        );
        // You might want to handle this differently based on business requirements
        // For now, we'll allow it but log the warning
      }

      // Fetch comprehensive vehicle data from external APIs
      const vehicleData = await this.fetchVehicleData(dto.registration_number);

      // Create vehicle record with combined data
      const vehicle = await this.createVehicleRecord(userId, vehicleData);

      this.logger.log(
        `Successfully added vehicle ${dto.registration_number} for user ${userId}`,
      );

      return {
        success: true,
        message: 'Vehicle added successfully',
        data: vehicle,
      };
    } catch (error) {
      this.logger.error(`Failed to add vehicle for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get all vehicles for a specific driver
   *
   * @param userId - ID of the driver
   * @returns Promise<Vehicle[]> - List of vehicles owned by the driver
   */
  async getVehiclesByUser(userId: string) {
    try {
      this.logger.log(`Fetching vehicles for user ${userId}`);

      // Validate user exists and is a driver
      await this.validateUserAndRole(userId, 'DRIVER');

      const vehicles = await this.prisma.vehicle.findMany({
        where: {
          user_id: userId,
        },
        include: {
          mot_reports: {
            orderBy: {
              created_at: 'desc',
            },
            take: 1, // Get latest MOT report
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      this.logger.log(`Found ${vehicles.length} vehicles for user ${userId}`);

      return {
        success: true,
        message: 'Vehicles retrieved successfully',
        data: vehicles,
      };
    } catch (error) {
      this.logger.error(`Failed to get vehicles for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific vehicle by ID
   *
   * @param userId - ID of the driver (for authorization)
   * @param vehicleId - ID of the vehicle to retrieve
   * @returns Promise<Vehicle> - Vehicle details
   */
  async getVehicleById(userId: string, vehicleId: string) {
    try {
      this.logger.log(`Fetching vehicle ${vehicleId} for user ${userId}`);

      // Validate user exists and is a driver
      await this.validateUserAndRole(userId, 'DRIVER');

      const vehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          user_id: userId,
        },
        include: {
          mot_reports: {
            orderBy: {
              created_at: 'desc',
            },
          },
        },
      });

      if (!vehicle) {
        throw new NotFoundException(`Vehicle not found or access denied`);
      }

      this.logger.log(`Successfully retrieved vehicle ${vehicleId}`);

      return {
        success: true,
        message: 'Vehicle retrieved successfully',
        data: vehicle,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get vehicle ${vehicleId} for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update vehicle information
   *
   * @param userId - ID of the driver
   * @param vehicleId - ID of the vehicle to update
   * @param dto - Update data
   * @returns Promise<Vehicle> - Updated vehicle
   */
  async updateVehicle(
    userId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ) {
    try {
      this.logger.log(`Updating vehicle ${vehicleId} for user ${userId}`);

      // Validate user exists and is a driver
      await this.validateUserAndRole(userId, 'DRIVER');

      // Check if vehicle exists and belongs to user
      const existingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          user_id: userId,
        },
      });

      if (!existingVehicle) {
        throw new NotFoundException(`Vehicle not found or access denied`);
      }

      // Update vehicle
      const updatedVehicle = await this.prisma.vehicle.update({
        where: {
          id: vehicleId,
        },
        data: {
          ...dto,
          updated_at: new Date(),
        },
      });

      this.logger.log(`Successfully updated vehicle ${vehicleId}`);

      return {
        success: true,
        message: 'Vehicle updated successfully',
        data: updatedVehicle,
      };
    } catch (error) {
      this.logger.error(
        `Failed to update vehicle ${vehicleId} for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Delete a vehicle (soft delete)
   *
   * @param userId - ID of the driver
   * @param vehicleId - ID of the vehicle to delete
   * @returns Promise<{success: boolean}> - Deletion confirmation
   */
  async deleteVehicle(userId: string, vehicleId: string) {
    try {
      this.logger.log(`Deleting vehicle ${vehicleId} for user ${userId}`);

      // Validate user exists and is a driver
      await this.validateUserAndRole(userId, 'DRIVER');

      // Check if vehicle exists and belongs to user
      const existingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          user_id: userId,
        },
      });

      if (!existingVehicle) {
        throw new NotFoundException(`Vehicle not found or access denied`);
      }

      // Soft delete vehicle
      await this.prisma.vehicle.update({
        where: {
          id: vehicleId,
        },
        data: {},
      });

      this.logger.log(`Successfully deleted vehicle ${vehicleId}`);

      return {
        success: true,
        message: 'Vehicle deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete vehicle ${vehicleId} for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Validate user exists and has the required role
   *
   * @param userId - User ID to validate
   * @param requiredRole - Role the user must have
   * @returns Promise<User> - Validated user
   */
  private async validateUserAndRole(userId: string, requiredRole: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deleted_at: null,
      },
      include: {
        role_users: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // console.log(user);

    const hasRequiredRole = user?.type === requiredRole;

    if (!hasRequiredRole) {
      throw new BadRequestException(`User must have ${requiredRole} role`);
    }

    return user;
  }

  /**
   * Fetch vehicle data from external APIs
   *
   * @param registrationNumber - Vehicle registration number
   * @returns Promise<CombinedVehicleData> - Vehicle data from both APIs
   */
  private async fetchVehicleData(
    registrationNumber: string,
  ): Promise<CombinedVehicleData> {
    try {
      this.logger.log(
        `Fetching external data for vehicle: ${registrationNumber}`,
      );

      const vehicleData =
        await DvlaService.getCompleteVehicleData(registrationNumber);

      this.logger.log(
        `Successfully fetched external data for: ${registrationNumber}`,
      );
      return vehicleData;
    } catch (error) {
      this.logger.error(
        `Failed to fetch external data for ${registrationNumber}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Unable to validate vehicle with external databases: ${error.message}`,
      );
    }
  }

  /**
   * Create vehicle record in database with combined external data
   *
   * @param userId - ID of the driver
   * @param vehicleData - Combined data from external APIs
   * @returns Promise<Vehicle> - Created vehicle record
   */
  private async createVehicleRecord(
    userId: string,
    vehicleData: CombinedVehicleData,
  ) {
    try {
      // Prepare vehicle data with fallbacks
      const vehicleRecord = {
        user_id: userId,
        registration_number: vehicleData.registrationNumber,

        // Use MOT data if available, fallback to DVLA data
        make: vehicleData.motData?.make || vehicleData.dvlaData?.make || null,
        model: vehicleData.motData?.model || null,
        color:
          vehicleData.motData?.primaryColour ||
          vehicleData.dvlaData?.colour ||
          null,
        fuel_type:
          vehicleData.motData?.fuelType ||
          vehicleData.dvlaData?.fuelType ||
          null,

        // Additional fields from DVLA data
        year_of_manufacture: vehicleData.dvlaData?.yearOfManufacture || null,
        engine_capacity: vehicleData.dvlaData?.engineCapacity || null,
        co2_emissions: vehicleData.dvlaData?.co2Emissions || null,
        mot_expiry_date: vehicleData.dvlaData?.motExpiryDate
          ? new Date(vehicleData.dvlaData.motExpiryDate)
          : null,

        // Store raw API responses for future reference
        dvla_data: vehicleData.dvlaData
          ? JSON.stringify(vehicleData.dvlaData)
          : null,
        mot_data: vehicleData.motData
          ? JSON.stringify(vehicleData.motData)
          : null,
      };

      const vehicle = await this.prisma.vehicle.create({
        data: vehicleRecord,
      });

      // If we have MOT history, create MOT report records
      if (
        vehicleData.motData?.motTests &&
        vehicleData.motData.motTests.length > 0
      ) {
        await this.createMotReports(vehicle.id, vehicleData.motData.motTests);
      }

      return vehicle;
    } catch (error) {
      this.logger.error('Failed to create vehicle record:', error);
      throw new InternalServerErrorException(
        'Failed to save vehicle to database',
      );
    }
  }

  /**
   * Create MOT report records from MOT history data
   *
   * @param vehicleId - ID of the vehicle
   * @param motTests - Array of MOT test results
   */
  private async createMotReports(vehicleId: string, motTests: any[]) {
    try {
      for (const test of motTests) {
        // 1. Create the MotReport record (one per test)
        const report = await this.prisma.motReport.create({
          data: {
            vehicle_id: vehicleId,
            test_number: test.motTestNumber,
            test_date: test.completedDate ? new Date(test.completedDate) : null,
            expiry_date: test.expiryDate ? new Date(test.expiryDate) : null,
            status: test.testResult,
            odometer_value: test.odometerValue
              ? parseInt(test.odometerValue, 10)
              : null,
            odometer_unit: test.odometerUnit,
            odometer_result_type: test.odometerResultType,
            data_source: test.dataSource,
            registration_at_test: test.registrationAtTimeOfTest,
          },
        });

        // 2. Create MotDefect records (one per defect)
        if (Array.isArray(test.defects) && test.defects.length > 0) {
          await this.prisma.motDefect.createMany({
            data: test.defects.map((defect) => ({
              mot_report_id: report.id,
              type: defect.type,
              text: defect.text,
              dangerous: defect.dangerous,
            })),
          });
        }
      }

      this.logger.log(
        `Created ${motTests.length} MOT reports (and defects) for vehicle ${vehicleId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create MOT reports for vehicle ${vehicleId}:`,
        error,
      );
      // Don't throw error here as vehicle creation should still succeed
    }
  }

  async getMotReportWithDefects(reportId: string) {
    return await this.prisma.motReport.findUnique({
      where: { id: reportId },
      include: { defects: true },
    });
  }

  async getCompleteMotHistory(vehicleId: string) {
    // Get vehicle details
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });

    // Get all MOT reports with defects
    const reports = await this.prisma.motReport.findMany({
      where: { vehicle_id: vehicleId },
      include: { defects: true },
      orderBy: { test_date: 'desc' },
    });

    // Transform to match original API structure
    return {
      registration: vehicle?.registration_number,
      make: vehicle?.make,
      model: vehicle?.model,
      firstUsedDate: vehicle?.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,
      fuelType: vehicle?.fuel_type,
      primaryColour: vehicle?.color,
      registrationDate: vehicle?.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,
      manufactureDate: vehicle?.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,
      engineSize: vehicle?.engine_capacity?.toString(),
      hasOutstandingRecall: 'Unknown',
      motTests: reports.map((report) => ({
        registrationAtTimeOfTest: report.registration_at_test,
        motTestNumber: report.test_number,
        completedDate: report.test_date?.toISOString(),
        expiryDate: report.expiry_date?.toISOString()?.split('T')[0],
        odometerValue: report.odometer_value?.toString(),
        odometerUnit: report.odometer_unit,
        odometerResultType: report.odometer_result_type,
        testResult: report.status,
        dataSource: report.data_source,
        defects: report.defects.map((defect) => ({
          dangerous: defect.dangerous,
          text: defect.text,
          type: defect.type,
        })),
      })),
    };
  }
}
