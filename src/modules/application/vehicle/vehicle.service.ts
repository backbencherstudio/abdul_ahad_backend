import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import {
  DvlaService,
  CombinedVehicleData,
} from 'src/common/lib/DVLA/DvlaService';
import { GetMotReportsQueryDto } from './dto/mot-reports-query.dto';

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

      if (!user) {
      }

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
        const ownerName =
          `${globalExistingVehicle.user.first_name || ''} ${globalExistingVehicle.user.last_name || ''}`.trim() ||
          'Unknown';
        this.logger.warn(
          `Vehicle ${dto.registration_number} already registered by another user: ${globalExistingVehicle.user.email}`,
        );
        // Throw error early with clear message since database constraint prevents duplicate registration numbers
        throw new ConflictException(
          `Vehicle with registration ${dto.registration_number} is already registered by another user (${ownerName} - ${globalExistingVehicle.user.email}). Each vehicle registration number can only be associated with one account.`,
        );
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
        select: {
          id: true,
          registration_number: true,
          make: true,
          model: true,
          color: true,
          fuel_type: true,
          year_of_manufacture: true,
          engine_capacity: true,
          co2_emissions: true,
          created_at: true,
          mot_expiry_date: true,
          user_id: true,
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
   * Delete a vehicle with cascade deletion of related records
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

      // Cascade delete vehicle and all related records in a transaction
      await this.prisma.$transaction(async (tx) => {
        // Step 1: Get all MOT report IDs for this vehicle
        const motReports = await tx.motReport.findMany({
          where: { vehicle_id: vehicleId },
          select: { id: true },
        });

        const motReportIds = motReports.map((report) => report.id);

        // Step 2: Delete all MotDefects related to these MOT reports
        if (motReportIds.length > 0) {
          const deletedDefects = await tx.motDefect.deleteMany({
            where: { mot_report_id: { in: motReportIds } },
          });
          this.logger.log(
            `Deleted ${deletedDefects.count} MOT defects for vehicle ${vehicleId}`,
          );
        }

        // Step 3: Delete all MotReports for this vehicle
        const deletedReports = await tx.motReport.deleteMany({
          where: { vehicle_id: vehicleId },
        });
        this.logger.log(
          `Deleted ${deletedReports.count} MOT reports for vehicle ${vehicleId}`,
        );

        // Step 4: Finally delete the vehicle
        await tx.vehicle.delete({
          where: { id: vehicleId },
        });
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
      // Handle Prisma unique constraint violation (P2002)
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target as string[];

        // Check if it's a registration_number constraint violation
        if (target?.includes('registration_number')) {
          this.logger.warn(
            `Vehicle with registration ${vehicleData.registrationNumber} already exists`,
          );

          // Try to find the existing vehicle
          const existingVehicle = await this.prisma.vehicle.findUnique({
            where: {
              registration_number: vehicleData.registrationNumber,
            },
          });

          if (existingVehicle) {
            // If it belongs to the same user, return it (race condition handled)
            if (existingVehicle.user_id === userId) {
              this.logger.log(
                `Vehicle ${vehicleData.registrationNumber} already exists for user ${userId}, returning existing vehicle`,
              );
              return existingVehicle;
            } else {
              // Vehicle exists for a different user - fetch user details for better error
              const existingUser = await this.prisma.user.findUnique({
                where: { id: existingVehicle.user_id },
                select: {
                  email: true,
                  first_name: true,
                  last_name: true,
                },
              });

              const ownerName = existingUser
                ? `${existingUser.first_name || ''} ${existingUser.last_name || ''}`.trim() ||
                  'Unknown'
                : 'Unknown';

              throw new ConflictException(
                `Vehicle with registration ${vehicleData.registrationNumber} is already registered by another user (${ownerName} - ${existingUser?.email || 'Unknown'}). Each vehicle registration number can only be associated with one account.`,
              );
            }
          }
        }
      }

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

  /**
   * Refresh vehicle MOT history from DVLA API
   * Fetches latest data, filters duplicates, and updates database
   *
   * @param userId - ID of the user
   * @param vehicleId - ID of the vehicle
   */
  async refreshMotHistory(userId: string, vehicleId: string) {
    try {
      this.logger.log(`Refreshing MOT history for vehicle ${vehicleId}`);

      // 1. Validate user and get vehicle
      await this.validateUserAndRole(userId, 'DRIVER');

      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, user_id: userId },
      });

      if (!vehicle) {
        throw new NotFoundException('Vehicle not found or access denied');
      }

      // 2. Fetch latest history from DVLA
      const motHistory = await DvlaService.getMotHistory(
        vehicle.registration_number,
      );

      if (!motHistory || !motHistory.motTests) {
        return {
          success: true,
          message: 'No MOT history found from DVLA',
          data: { new_records: 0 },
        };
      }

      // 3. Get existing local records to check for duplicates
      const existingReports = await this.prisma.motReport.findMany({
        where: { vehicle_id: vehicleId },
        select: { test_number: true },
      });

      const existingTestNumbers = new Set(
        existingReports.map((r) => r.test_number),
      );

      // 4. Filter for new tests only
      const newTests = motHistory.motTests.filter(
        (test) => !existingTestNumbers.has(test.motTestNumber),
      );

      if (newTests.length === 0) {
        this.logger.log(
          `Vehicle ${vehicle.registration_number} is already up to date`,
        );
        return {
          success: true,
          message: 'MOT history is already up to date',
          data: { new_records: 0 },
        };
      }

      this.logger.log(
        `Found ${newTests.length} new MOT tests for ${vehicle.registration_number}`,
      );

      // 5. Insert new records concurrently using Promise.all
      // Note: We use a transaction to ensure data integrity if needed, but for bulk independent inserts
      // Promise.all with individual creates is sufficient and mandated by the request.
      // However, createMotReports logic handles defects too, so we'll adapt that pattern inline for concurrency.

      await Promise.all(
        newTests.map(async (test) => {
          // Create report with defects in a transaction to ensure report+defects consistency per test
          return this.prisma.$transaction(async (tx) => {
            const report = await tx.motReport.create({
              data: {
                vehicle_id: vehicleId,
                test_number: test.motTestNumber,
                test_date: test.completedDate
                  ? new Date(test.completedDate)
                  : null,
                expiry_date: test.expiryDate ? new Date(test.expiryDate) : null,
                status: test.motTestResult, // Note: API uses 'motTestResult', DB uses 'status'
                odometer_value: test.odometerValue
                  ? parseInt(test.odometerValue, 10)
                  : null,
                odometer_unit: test.odometerUnit,
                odometer_result_type: test.odometerResultType,
                data_source: 'dvsa', // Explicitly mark as refresh source
                registration_at_test: test.registrationAtTimeOfTest,
              },
            });

            if (
              Array.isArray(test.rfrAndComments) &&
              test.rfrAndComments.length > 0
            ) {
              // Map API 'rfrAndComments' to our DB 'MotDefect' structure
              await tx.motDefect.createMany({
                data: test.rfrAndComments.map((defect) => ({
                  mot_report_id: report.id,
                  type: defect.type,
                  text: defect.text,
                  dangerous: defect.dangerous,
                })),
              });
            }
          });
        }),
      );

      // 6. Update local vehicle data with latest info if available (optional but good for consistency)
      // We'll update the 'updated_at' timestamp at minimum
      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { updated_at: new Date() },
      });

      return {
        success: true,
        message: `Successfully added ${newTests.length} new MOT records`,
        data: {
          new_records: newTests.length,
          latest_expiry: motHistory.motTests[0]?.expiryDate || null,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to refresh MOT history for vehicle ${vehicleId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get complete MOT report with vehicle details for report generation/download
   *
   * @param reportId - MOT Report ID
   * @returns Complete report data ready for PDF/report generation
   */
  async getMotReportWithDefects(reportId: string) {
    try {
      this.logger.log(`Fetching complete MOT report details for: ${reportId}`);

      // Get MOT report with defects and vehicle details
      const report = await this.prisma.motReport.findUnique({
        where: { id: reportId },
        include: {
          defects: true,
          vehicle: true, // ✅ Include complete vehicle information
        },
      });

      if (!report) {
        throw new NotFoundException('MOT report not found');
      }

      // Build comprehensive response for report generation
      return {
        success: true,
        message: 'MOT report retrieved successfully',
        data: {
          // Report metadata
          reportId: report.id,

          // Vehicle information
          vehicle: {
            registration: report.vehicle.registration_number,
            make: report.vehicle.make,
            model: report.vehicle.model,
            colour: report.vehicle.color,
            fuelType: report.vehicle.fuel_type,
            engineCapacity: report.vehicle.engine_capacity,
            yearOfManufacture: report.vehicle.year_of_manufacture,
            registrationDate: report.vehicle.year_of_manufacture
              ? `${report.vehicle.year_of_manufacture}-01-01`
              : null,
          },

          // MOT test details
          motTest: {
            testNumber: report.test_number,
            testDate: report.test_date?.toISOString(),
            expiryDate: report.expiry_date?.toISOString(),
            testResult: report.status,
            registrationAtTimeOfTest: report.registration_at_test,

            // Odometer information
            odometer: {
              value: report.odometer_value,
              unit: report.odometer_unit,
              resultType: report.odometer_result_type,
            },

            dataSource: report.data_source,
          },

          // Defects information
          defects: {
            total: report.defects?.length || 0,
            dangerous: report.defects?.filter((d) => d.dangerous).length || 0,
            items:
              report.defects?.map((defect) => ({
                id: defect.id,
                type: defect.type,
                text: defect.text,
                dangerous: defect.dangerous,
              })) || [],
          },

          // Additional metadata for report generation
          reportMetadata: {
            generatedAt: new Date().toISOString(),
            reportType: 'MOT_TEST_CERTIFICATE',
            isPassed: report.status === 'PASSED',
            hasDefects: (report.defects?.length || 0) > 0,
            hasDangerousDefects:
              (report.defects?.filter((d) => d.dangerous).length || 0) > 0,
          },
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get MOT report ${reportId}:`, error);
      throw error;
    }
  }

  async getCompleteMotHistory(
    vehicleId: string,
    userId?: string,
    query?: GetMotReportsQueryDto,
  ) {
    try {
      this.logger.log(
        `Fetching MOT history for vehicle ${vehicleId} with query:`,
        query,
      );

      // Validate user access if userId provided
      if (userId) {
        await this.validateUserAndRole(userId, 'DRIVER');
      }

      // Get vehicle details
      const vehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          ...(userId && { user_id: userId }), // Only filter by user if userId provided
        },
      });

      if (!vehicle) {
        throw new NotFoundException('Vehicle not found or access denied');
      }

      // Parse query parameters
      const {
        fields = '',
        include_defects = true,
        limit = 10,
        page = 1,
        full_response = false,
      } = query || {};

      const skip = (page - 1) * limit;

      // If full_response is true or no fields specified, return complete response (backward compatibility)
      if (full_response || !fields) {
        return this.getFullMotHistory(vehicle, include_defects, limit, skip);
      }

      // Parse requested fields
      const requestedFields = this.parseRequestedFields(fields);

      // Get MOT reports based on field requirements
      const reports = await this.getMotReportsForFields(
        vehicleId,
        requestedFields,
        include_defects,
        limit,
        skip,
      );

      // Build response based on requested fields
      const response = this.buildPartialResponse(
        vehicle,
        reports,
        requestedFields,
      );

      // Add query info for transparency
      response.query_info = {
        fields_requested: fields,
        include_defects,
        limit,
        page,
        full_response,
        total_reports: reports.length,
      };

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to get MOT history for vehicle ${vehicleId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get full MOT history (backward compatibility)
   */
  private async getFullMotHistory(
    vehicle: any,
    includeDefects: boolean,
    limit: number,
    skip: number,
  ) {
    // ✅ Fix: Use proper Prisma include syntax
    const includeOptions = includeDefects ? { defects: true } : undefined;

    const reports = await this.prisma.motReport.findMany({
      where: { vehicle_id: vehicle.id },
      include: includeOptions, // ✅ Fixed: Use undefined instead of false
      orderBy: { test_date: 'desc' },
      take: limit,
      skip,
    });

    return {
      // Vehicle basic information
      registration: vehicle.registration_number,
      make: vehicle.make,
      model: vehicle.model,

      // Vehicle details for UI display
      primaryColour: vehicle.color,
      fuelType: vehicle.fuel_type,
      engineSize: vehicle.engine_capacity?.toString(),

      // Date information
      firstUsedDate: vehicle.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,
      registrationDate: vehicle.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,
      manufactureDate: vehicle.year_of_manufacture
        ? `${vehicle.year_of_manufacture}-01-01`
        : null,

      // MOT expiry from vehicle record
      motExpiryDate: vehicle.mot_expiry_date?.toISOString(),

      hasOutstandingRecall: 'Unknown',

      // MOT test history with report IDs
      motTests: reports.map((report) => ({
        reportId: report.id, // ✅ Added: Report ID for navigation/linking
        registrationAtTimeOfTest: report.registration_at_test,
        motTestNumber: report.test_number,
        completedDate: report.test_date?.toISOString(),
        expiryDate: report.expiry_date?.toISOString(),
        odometerValue: report.odometer_value?.toString(),
        odometerUnit: report.odometer_unit,
        odometerResultType: report.odometer_result_type,
        testResult: report.status,
        dataSource: report.data_source,
        // ✅ Fix: Handle defects safely
        defects:
          includeDefects && report.defects
            ? report.defects.map((defect) => ({
                dangerous: defect.dangerous,
                text: defect.text,
                type: defect.type,
              }))
            : [],
      })),
    };
  }

  /**
   * Parse requested fields from query string
   */
  private parseRequestedFields(fields: string): {
    vehicleFields: string[];
    reportFields: string[];
    includeDefects: boolean;
  } {
    const fieldList = fields.split(',').map((f) => f.trim().toLowerCase());

    // Predefined field groups
    const fieldGroups = {
      basic: [
        'registration',
        'make',
        'model',
        'test_number',
        'test_date',
        'status',
        'expiry_date',
      ],
      summary: [
        'registration',
        'make',
        'model',
        'test_number',
        'test_date',
        'status',
        'expiry_date',
        'odometer_value',
        'defects_count',
      ],
      detailed: [
        'registration',
        'make',
        'model',
        'fuel_type',
        'color',
        'engine_size',
        'year',
        'test_number',
        'test_date',
        'expiry_date',
        'status',
        'odometer_value',
        'odometer_unit',
        'data_source',
        'defects',
      ],
      full: [
        'registration',
        'make',
        'model',
        'fuel_type',
        'color',
        'engine_size',
        'year',
        'test_number',
        'test_date',
        'expiry_date',
        'status',
        'odometer_value',
        'odometer_unit',
        'data_source',
        'defects',
      ],
    };

    // Check if it's a predefined group
    if (fieldGroups[fields.toLowerCase()]) {
      const groupFields = fieldGroups[fields.toLowerCase()];
      return this.categorizeFields(groupFields);
    }

    // Individual fields
    return this.categorizeFields(fieldList);
  }

  /**
   * Categorize fields into vehicle and report fields
   */
  private categorizeFields(fields: string[]): {
    vehicleFields: string[];
    reportFields: string[];
    includeDefects: boolean;
  } {
    const vehicleFieldMap = {
      registration: 'registration_number',
      make: 'make',
      model: 'model',
      fuel_type: 'fuel_type',
      color: 'color',
      engine_size: 'engine_capacity',
      year: 'year_of_manufacture',
    };

    const reportFieldMap = {
      test_number: 'test_number',
      test_date: 'test_date',
      expiry_date: 'expiry_date',
      status: 'status',
      odometer_value: 'odometer_value',
      odometer_unit: 'odometer_unit',
      data_source: 'data_source',
      defects_count: 'defects_count',
      dangerous_defects: 'dangerous_defects',
    };

    const vehicleFields = [];
    const reportFields = [];
    let includeDefects = false;

    for (const field of fields) {
      if (vehicleFieldMap[field]) {
        vehicleFields.push(vehicleFieldMap[field]);
      } else if (reportFieldMap[field]) {
        reportFields.push(reportFieldMap[field]);
        if (
          field === 'defects' ||
          field === 'defects_count' ||
          field === 'dangerous_defects'
        ) {
          includeDefects = true;
        }
      }
    }

    return { vehicleFields, reportFields, includeDefects };
  }

  /**
   * Get MOT reports based on field requirements
   */
  private async getMotReportsForFields(
    vehicleId: string,
    fieldCategories: {
      vehicleFields: string[];
      reportFields: string[];
      includeDefects: boolean;
    },
    includeDefects: boolean,
    limit: number,
    skip: number,
  ) {
    const { reportFields, includeDefects: fieldsRequireDefects } =
      fieldCategories;

    const shouldIncludeDefects = includeDefects || fieldsRequireDefects;

    // ✅ Fix: Use proper Prisma include syntax
    const includeOptions = shouldIncludeDefects ? { defects: true } : undefined;

    return await this.prisma.motReport.findMany({
      where: { vehicle_id: vehicleId },
      include: includeOptions, // ✅ Fixed: Use undefined instead of false
      orderBy: { test_date: 'desc' },
      take: limit,
      skip,
    });
  }

  /**
   * Build partial response based on requested fields
   */
  private buildPartialResponse(
    vehicle: any,
    reports: any[],
    fieldCategories: {
      vehicleFields: string[];
      reportFields: string[];
      includeDefects: boolean;
    },
  ) {
    const { vehicleFields, reportFields } = fieldCategories;
    const response: any = {};

    // Add vehicle fields
    if (vehicleFields.includes('registration_number')) {
      response.registration = vehicle.registration_number;
    }
    if (vehicleFields.includes('make')) {
      response.make = vehicle.make;
    }
    if (vehicleFields.includes('model')) {
      response.model = vehicle.model;
    }
    if (vehicleFields.includes('fuel_type')) {
      response.fuelType = vehicle.fuel_type;
    }
    if (vehicleFields.includes('color')) {
      response.primaryColour = vehicle.color;
    }
    if (vehicleFields.includes('engine_capacity')) {
      response.engineSize = vehicle.engine_capacity?.toString();
    }
    if (vehicleFields.includes('year_of_manufacture')) {
      const year = vehicle.year_of_manufacture;
      response.firstUsedDate = year ? `${year}-01-01` : null;
      response.registrationDate = year ? `${year}-01-01` : null;
      response.manufactureDate = year ? `${year}-01-01` : null;
    }

    // Add MOT reports if any report fields are requested
    if (reportFields.length > 0) {
      response.motTests = reports.map((report) => {
        const motTest: any = {
          reportId: report.id, // ✅ Always include report ID for navigation
        };

        if (reportFields.includes('test_number')) {
          motTest.motTestNumber = report.test_number;
        }
        if (reportFields.includes('test_date')) {
          motTest.completedDate = report.test_date?.toISOString();
        }
        if (reportFields.includes('expiry_date')) {
          motTest.expiryDate = report.expiry_date?.toISOString();
        }
        if (reportFields.includes('status')) {
          motTest.testResult = report.status;
        }
        if (reportFields.includes('odometer_value')) {
          motTest.odometerValue = report.odometer_value?.toString();
        }
        if (reportFields.includes('odometer_unit')) {
          motTest.odometerUnit = report.odometer_unit;
        }
        if (reportFields.includes('data_source')) {
          motTest.dataSource = report.data_source;
        }

        // ✅ Fix: Handle defects safely with proper type checking
        if (reportFields.includes('defects_count')) {
          motTest.defects_count = report.defects ? report.defects.length : 0;
        }
        if (reportFields.includes('dangerous_defects')) {
          motTest.dangerous_defects = report.defects
            ? report.defects.filter((d) => d.dangerous)
            : [];
        }
        if (reportFields.includes('defects')) {
          motTest.defects = report.defects
            ? report.defects.map((defect) => ({
                dangerous: defect.dangerous,
                text: defect.text,
                type: defect.type,
              }))
            : [];
        }

        return motTest;
      });
    }

    return response;
  }
}
