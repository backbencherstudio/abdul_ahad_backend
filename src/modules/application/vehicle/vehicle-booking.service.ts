import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, ServiceType, UserRole } from '@prisma/client';
import { DvlaService } from 'src/common/lib/DVLA/DvlaService';
import { VehicleService } from './vehicle.service';
import { VehicleGarageService } from './vehicle-garage.service';
import { SearchGarageDto } from './dto/search-garage.dto';
import {
  GarageSearchResponseDto,
  VehicleInfoDto,
} from './dto/garage-search-response.dto';
import { BookableServiceType, BookSlotDto } from './dto/book-slot.dto';
import {
  GetMyBookingsDto,
  MyBookingsResponseDto,
  BookingDto,
} from './dto/my-bookings.dto';

@Injectable()
export class VehicleBookingService {
  private readonly logger = new Logger(VehicleBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleService: VehicleService,
    private readonly vehicleGarageService: VehicleGarageService,
  ) {}

  /**
   * Search garages by postcode with vehicle validation
   * This is the main entry point for the booking flow
   */
  async searchGaragesByPostcode(
    userId: string,
    searchData: SearchGarageDto,
  ): Promise<GarageSearchResponseDto> {
    try {
      this.logger.log(
        `Searching garages for user ${userId} with registration ${searchData.registration_number} near ${searchData.postcode}`,
      );

      // Step 1: Validate vehicle with DVLA
      const vehicleInfo = await this.validateVehicleWithDVLA(
        searchData.registration_number,
      );

      // Step 2: Check if vehicle exists in user's account
      let existingVehicle = await this.prisma.vehicle.findFirst({
        where: {
          user_id: userId,
          registration_number: searchData.registration_number.toUpperCase(),
        },
      });

      // Step 3: If vehicle doesn't exist, create it
      if (!existingVehicle) {
        this.logger.log(
          `Vehicle ${searchData.registration_number} not found in user account, creating new vehicle`,
        );

        // ✅ FIXED: Extract vehicle data from the response
        const vehicleResponse = await this.vehicleService.addVehicle(userId, {
          registration_number: searchData.registration_number,
        });

        existingVehicle = vehicleResponse.data; // Extract the vehicle object
      }

      // Step 4: Update vehicle info with database ID
      vehicleInfo.exists_in_account = true;
      vehicleInfo.vehicle_id = existingVehicle.id; // ✅ NOW INCLUDED

      // Step 5: Find active garages by postcode
      const garages = await this.vehicleGarageService.findActiveGarages(
        searchData.postcode,
      );

      this.logger.log(`Found ${garages.length} garages for user ${userId}`);

      return {
        vehicle: vehicleInfo,
        garages,
        total_count: garages.length,
        search_postcode: searchData.postcode,
      };
    } catch (error) {
      this.logger.error(
        `Error searching garages: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get available slots for a garage on a specific date
   */
  async getAvailableSlots(garageId: string, date: string): Promise<any[]> {
    try {
      this.logger.log(
        `Fetching available slots for garage ${garageId} on ${date}`,
      );

      // Validate garage availability
      const isGarageAvailable =
        await this.vehicleGarageService.validateGarageAvailability(garageId);

      if (!isGarageAvailable) {
        throw new NotFoundException('Garage not available for bookings');
      }

      // Parse and validate date
      const targetDate = new Date(date + 'T00:00:00Z');
      if (isNaN(targetDate.getTime())) {
        throw new BadRequestException('Invalid date format');
      }

      // Get available slots for the date
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const slots = await this.prisma.timeSlot.findMany({
        where: {
          garage_id: garageId,
          start_datetime: {
            gte: startOfDay,
            lte: endOfDay,
          },
          is_available: true,
          is_blocked: false,
          order_id: null, // Not booked
        },
        orderBy: {
          start_datetime: 'asc',
        },
      });

      this.logger.log(
        `Found ${slots.length} available slots for garage ${garageId}`,
      );

      return slots.map((slot) => {
        const startDate = new Date(slot.start_datetime);
        const endDate = new Date(slot.end_datetime);
        const dateStr = startDate.toISOString().split('T')[0];
        // Format time as HH:mm in UTC
        const startTime = `${String(startDate.getUTCHours()).padStart(2, '0')}:${String(startDate.getUTCMinutes()).padStart(2, '0')}`;
        const endTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}`;

        return {
          id: slot.id,
          start_time: startTime,
          end_time: endTime,
          date: dateStr,
        };
      });
    } catch (error) {
      this.logger.error(
        `Error fetching available slots: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Book a slot for MOT or Retest (no payment)
   */
  async bookSlot(userId: string, bookingData: BookSlotDto): Promise<any> {
    try {
      this.logger.log(
        `Booking slot for user ${userId} with garage ${bookingData.garage_id}`,
      );

      // Step 1: Validate user and vehicle ownership
      const user = await this.validateUserAndVehicle(
        userId,
        bookingData.vehicle_id,
      );

      // Step 2: Validate garage availability
      const isGarageAvailable =
        await this.vehicleGarageService.validateGarageAvailability(
          bookingData.garage_id,
        );

      if (!isGarageAvailable) {
        throw new NotFoundException('Garage not available for bookings');
      }

      // Step 3: Validate slot availability
      const slot = await this.validateSlotAvailability(
        bookingData.slot_id,
        bookingData.garage_id,
      );

      // Step 4: Get service details
      const service = await this.getServiceDetails(
        bookingData.garage_id,
        bookingData.service_type,
      );

      // Step 5: Create booking (transaction to ensure data consistency)
      const booking = await this.prisma.$transaction(async (tx) => {
        // Create order
        const order = await tx.order.create({
          data: {
            driver_id: userId,
            vehicle_id: bookingData.vehicle_id,
            garage_id: bookingData.garage_id,
            order_date: slot.start_datetime,
            status: OrderStatus.PENDING,
            total_amount: service.price,
            slot_id: bookingData.slot_id,
          },
        });

        // Create order item
        await tx.orderItem.create({
          data: {
            order_id: order.id,
            service_id: service.id,
            quantity: 1,
            price: service.price,
          },
        });

        // Update slot as booked
        await tx.timeSlot.update({
          where: { id: bookingData.slot_id },
          data: {
            order_id: order.id,
            is_available: false,
          },
        });

        return order;
      });

      this.logger.log(
        `Successfully booked slot for user ${userId}, order ID: ${booking.id}`,
      );

      return {
        success: true,
        message: 'Booking confirmed successfully',
        data: {
          order_id: booking.id,
          garage_id: booking.garage_id,
          vehicle_id: booking.vehicle_id,
          slot_id: booking.slot_id,
          service_type: bookingData.service_type,
          total_amount: booking.total_amount,
          order_date: booking.order_date,
          status: booking.status,
        },
      };
    } catch (error) {
      this.logger.error(`Error booking slot: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Validate vehicle with DVLA and return vehicle info
   */
  private async validateVehicleWithDVLA(
    registrationNumber: string,
  ): Promise<VehicleInfoDto> {
    try {
      this.logger.log(`Validating vehicle with DVLA: ${registrationNumber}`);

      const vehicleData =
        await DvlaService.getCompleteVehicleData(registrationNumber);

      if (!vehicleData) {
        throw new NotFoundException('Vehicle not found in DVLA system');
      }

      // Extract data from the combined response
      const dvlaData = vehicleData.dvlaData;
      const motData = vehicleData.motData;

      return {
        registration_number: registrationNumber.toUpperCase(),
        make: motData?.make || dvlaData?.make || 'Unknown',
        model: motData?.model || 'Unknown',
        color: motData?.primaryColour || dvlaData?.colour || 'Unknown',
        fuel_type: motData?.fuelType || dvlaData?.fuelType || 'Unknown',
        mot_expiry_date: dvlaData?.motExpiryDate || 'Unknown',
        exists_in_account: false, // Will be updated by caller
        vehicle_id: '', // ✅ ADDED: Temporary empty string, will be set by caller
      };
    } catch (error) {
      this.logger.error(
        `DVLA validation failed for ${registrationNumber}: ${error.message}`,
      );
      throw new NotFoundException('Vehicle not found in DVLA system');
    }
  }

  /**
   * Validate user and vehicle ownership
   */
  private async validateUserAndVehicle(
    userId: string,
    vehicleId: string,
  ): Promise<any> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        type: UserRole.DRIVER,
        status: 1,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found or not a driver');
    }

    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        user_id: userId,
      },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found or not owned by user');
    }

    return user;
  }

  /**
   * Validate slot availability
   */
  private async validateSlotAvailability(
    slotId: string,
    garageId: string,
  ): Promise<any> {
    const slot = await this.prisma.timeSlot.findFirst({
      where: {
        id: slotId,
        garage_id: garageId,
        is_available: true,
        is_blocked: false,
        order_id: null,
      },
    });

    if (!slot) {
      throw new ConflictException('Slot not available for booking');
    }

    return slot;
  }

  /**
   * Get service details for booking
   */
  private async getServiceDetails(
    garageId: string,
    serviceType: BookableServiceType,
  ): Promise<any> {
    const service = await this.prisma.service.findFirst({
      where: {
        garage_id: garageId,
        type: serviceType as ServiceType,
        price: {
          not: null,
        },
      },
    });

    if (!service) {
      throw new NotFoundException(
        `${serviceType} service not available for this garage`,
      );
    }

    return service;
  }

  async getMyBookings(
    userId: string,
    query: GetMyBookingsDto,
  ): Promise<MyBookingsResponseDto> {
    const { status = 'all', search = '', page = 1, limit = 10 } = query;

    // Build where clause
    const where: any = {
      driver_id: userId,
    };
    if (status && status !== 'all') {
      where.status = status.toUpperCase();
    }
    if (search) {
      where.OR = [
        { garage: { garage_name: { contains: search, mode: 'insensitive' } } },
        { garage: { address: { contains: search, mode: 'insensitive' } } },
        {
          vehicle: {
            registration_number: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Get total count for pagination
    const total_count = await this.prisma.order.count({ where });

    // Get paginated bookings
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        garage: true,
        vehicle: true,
        slot: true,
        items: { include: { service: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Map to BookingDto
    const bookings: BookingDto[] = orders.map((order) => ({
      order_id: order.id,
      garage_name: order.garage?.garage_name || '',
      location: [order.garage?.address, order.garage?.zip_code]
        .filter(Boolean)
        .join(', '),
      email: order.garage?.email || '',
      phone_number: order.garage?.phone_number || '',
      booking_date: order.slot
        ? order.slot.start_datetime.toISOString()
        : order.order_date.toISOString(),
      total_amount: order.total_amount?.toString() || '',
      status: order.status,
      vehicle_registration: order.vehicle?.registration_number || '',
      service_type: order.items[0]?.service?.type || '',
    }));

    const total_pages = Math.ceil(total_count / limit);

    return {
      bookings,
      pagination: {
        total_count,
        total_pages,
        current_page: page,
        limit,
        has_next: page < total_pages,
        has_prev: page > 1,
      },
      filters: {
        status,
        search: search || undefined,
      },
    };
  }
}
