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
import { GarageScheduleService } from '../garage-dashboard/services/garage-schedule.service';
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
    private readonly garageScheduleService: GarageScheduleService,
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
   * Returns template slots (no ID) + database slots (with ID)
   */
  async getAvailableSlots(garageId: string, date: string): Promise<any> {
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

      // Get schedule-based slots using GarageScheduleService
      const scheduleResponse =
        await this.garageScheduleService.viewAvailableSlots(garageId, date);

      // Check if response is valid and has data
      if (!scheduleResponse || !scheduleResponse.success) {
        this.logger.warn(
          `No schedule data found for garage ${garageId} on ${date}`,
        );
        return {
          success: true,
          message: 'No schedule found for this garage',
          data: [],
        };
      }

      // Extract slots from response data
      const responseData = scheduleResponse.data;

      // Handle the case where data exists but slots might be empty or missing
      if (!responseData || !responseData.slots) {
        this.logger.warn(
          `No slots in response data for garage ${garageId} on ${date}`,
        );
        return {
          success: true,
          message: 'No slots available for this date',
          data: [],
        };
      }

      const { slots } = responseData;

      // If slots array is empty, it might be a holiday or closed day
      if (!Array.isArray(slots) || slots.length === 0) {
        this.logger.log(
          `No slots available for ${date} - might be holiday or closed`,
        );
        return {
          success: true,
          message: 'No slots available for this date (holiday or closed)',
          data: [],
        };
      }

      // Format slots for driver view
      const formattedSlots = slots.map((slot: any) => {
        // Template slots don't have IDs
        if (!slot.id) {
          const [startTime, endTime] = slot.time.split('-');
          return {
            start_time: startTime,
            end_time: endTime,
            date,
            status: slot.status,
          };
        }

        // Database slots have IDs
        const [startTime, endTime] = slot.time.split('-');
        return {
          id: slot.id,
          start_time: startTime,
          end_time: endTime,
          date,
          status: slot.status,
        };
      });

      return {
        success: true,
        message: `Found ${formattedSlots.length} available slots`,
        data: formattedSlots,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching available slots: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Book a slot for MOT or Retest with race condition protection
   * Supports both ID-based (existing slots) and time-based (template slots) booking
   */
  async bookSlot(userId: string, bookingData: BookSlotDto): Promise<any> {
    try {
      this.logger.log(
        `Booking slot for user ${userId} with garage ${bookingData.garage_id}`,
      );

      // Step 1: Validate user and vehicle ownership
      await this.validateUserAndVehicle(userId, bookingData.vehicle_id);

      // Step 2: Validate garage availability
      const isGarageAvailable =
        await this.vehicleGarageService.validateGarageAvailability(
          bookingData.garage_id,
        );

      if (!isGarageAvailable) {
        throw new NotFoundException('Garage not available for bookings');
      }

      // Step 3: Get service details
      const service = await this.getServiceDetails(
        bookingData.garage_id,
        bookingData.service_type,
      );

      // Step 4: Book slot with race protection
      if (bookingData.slot_id) {
        // ID-based booking (existing database slot)
        return this.bookExistingSlot(userId, bookingData, service);
      } else {
        // Time-based booking (template slot - create and book atomically)
        return this.bookTemplateSlot(userId, bookingData, service);
      }
    } catch (error) {
      this.logger.error(`Error booking slot: ${error.message}`, error.stack);

      // ✅ Environment-aware error handling
      const isDevelopment = process.env.NODE_ENV === 'development';

      // If it's a known NestJS exception (BadRequest, NotFound, Conflict), throw as-is
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      // For other errors (Prisma, etc.), handle based on environment
      if (isDevelopment) {
        // Development: Show full error details
        throw new BadRequestException({
          message: 'Booking failed',
          error: error.message,
          stack: error.stack,
          details: error,
        });
      } else {
        // Production: Clean user-friendly message only
        this.logger.error('Booking error (production):', error);
        throw new BadRequestException(
          'Unable to complete booking. Please try again or contact support.',
        );
      }
    }
  }

  /**
   * Book an existing database slot
   */
  private async bookExistingSlot(
    userId: string,
    bookingData: BookSlotDto,
    service: any,
  ): Promise<any> {
    return await this.prisma.$transaction(
      async (tx) => {
        // Validate slot availability
        const slot = await tx.timeSlot.findFirst({
          where: {
            id: bookingData.slot_id,
            garage_id: bookingData.garage_id,
            is_available: true,
            is_blocked: false,
            order_id: null,
          },
        });

        if (!slot) {
          throw new ConflictException('Slot not available or already booked');
        }

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

        this.logger.log(
          `Successfully booked existing slot for user ${userId}, order ID: ${order.id}`,
        );

        return {
          success: true,
          message: 'Booking confirmed successfully',
          data: {
            order_id: order.id,
            garage_id: order.garage_id,
            vehicle_id: order.vehicle_id,
            slot_id: order.slot_id,
            service_type: bookingData.service_type,
            total_amount: order.total_amount,
            order_date: order.order_date,
            status: order.status,
          },
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * Book a template slot (atomic create + book with race protection)
   */
  private async bookTemplateSlot(
    userId: string,
    bookingData: BookSlotDto,
    service: any,
  ): Promise<any> {
    // Calculate datetime
    const startDateTime = new Date(
      `${bookingData.date}T${bookingData.start_time}:00`,
    );
    const endDateTime = new Date(
      `${bookingData.date}T${bookingData.end_time}:00`,
    );

    return await this.prisma.$transaction(
      async (tx) => {
        // Validate slot is bookable (schedule, holiday, break, etc.)
        await this.validateSlotIsBookable(
          bookingData.garage_id,
          startDateTime,
          endDateTime,
          tx,
        );

        // ✅ FIX: Check if slot exists FIRST to avoid transaction abort
        let slot = await tx.timeSlot.findUnique({
          where: {
            garage_id_start_datetime: {
              garage_id: bookingData.garage_id,
              start_datetime: startDateTime,
            },
          },
        });

        if (slot) {
          // Slot already exists, check if it's available
          if (slot.order_id) {
            throw new ConflictException(
              'This time slot has just been booked by another user. Please choose a different time.',
            );
          }

          this.logger.log(
            `Using existing slot ${slot.id} for time ${bookingData.start_time}`,
          );
        } else {
          // Slot doesn't exist, create it
          try {
            slot = await tx.timeSlot.create({
              data: {
                garage_id: bookingData.garage_id,
                start_datetime: startDateTime,
                end_datetime: endDateTime,
                is_available: false, // Immediately mark as unavailable
                is_blocked: false,
              },
            });

            this.logger.log(
              `Created new slot ${slot.id} for time ${bookingData.start_time}-${bookingData.end_time}`,
            );
          } catch (error: any) {
            // P2002 = Unique constraint violation (race condition - another user just created it)
            if (error.code === 'P2002') {
              this.logger.warn(
                `Race condition detected: slot created by another transaction for ${bookingData.start_time}`,
              );
              throw new ConflictException(
                'This time slot was just booked by another user. Please refresh and try a different time.',
              );
            }
            throw error;
          }
        }

        // Create order
        const order = await tx.order.create({
          data: {
            driver_id: userId,
            vehicle_id: bookingData.vehicle_id,
            garage_id: bookingData.garage_id,
            order_date: startDateTime,
            status: OrderStatus.PENDING,
            total_amount: service.price,
            slot_id: slot.id,
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

        // Update slot with order_id
        await tx.timeSlot.update({
          where: { id: slot.id },
          data: {
            order_id: order.id,
            is_available: false,
          },
        });

        this.logger.log(
          `Successfully booked template slot for user ${userId}, order ID: ${order.id}`,
        );

        return {
          success: true,
          message: 'Booking confirmed successfully',
          data: {
            order_id: order.id,
            garage_id: order.garage_id,
            vehicle_id: order.vehicle_id,
            slot_id: order.slot_id,
            service_type: bookingData.service_type,
            total_amount: order.total_amount,
            order_date: order.order_date,
            status: order.status,
          },
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * Validate that a slot time is bookable
   */
  private async validateSlotIsBookable(
    garageId: string,
    startDateTime: Date,
    endDateTime: Date,
    tx: any,
  ): Promise<void> {
    // 1. Get schedule
    const schedule = await tx.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule || !schedule.is_active) {
      throw new BadRequestException(
        'Garage does not have an active schedule for bookings',
      );
    }

    // 2. Check if date is in the past
    if (startDateTime < new Date()) {
      throw new BadRequestException('Cannot book slots in the past');
    }

    const dayOfWeek = startDateTime.getDay();

    // 3. Check Daily Hours (New System)
    // If daily_hours exists, it takes precedence for "Closed" status
    if (schedule.daily_hours) {
      const dailyHours =
        typeof schedule.daily_hours === 'string'
          ? JSON.parse(schedule.daily_hours)
          : schedule.daily_hours;

      const dayConfig = dailyHours[dayOfWeek.toString()];

      if (dayConfig && dayConfig.is_closed) {
        throw new BadRequestException(
          'Garage is closed on this day. Please choose another date.',
        );
      }
    }

    // 4. Parse restrictions (Legacy System)
    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions as string);
    // 4. Check if day is restricted (holiday)
    const bookingDateString = startDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
    const bookingMonth = startDateTime.getMonth() + 1; // 1-12
    const bookingDay = startDateTime.getDate(); // 1-31

    const isHoliday = restrictions.some((r: any) => {
      if (r.type !== 'HOLIDAY') {
        return false;
      }

      // Check specific date (YYYY-MM-DD)
      if (r.date && r.date === bookingDateString) {
        return true;
      }

      // Check annual recurring date (Month + Day)
      if (
        r.month &&
        r.day &&
        r.month === bookingMonth &&
        r.day === bookingDay
      ) {
        return true;
      }

      // Check day of week
      if (r.day_of_week !== undefined && r.day_of_week !== null) {
        // Handle array of days
        if (Array.isArray(r.day_of_week)) {
          return r.day_of_week.includes(dayOfWeek);
        }

        // Handle string vs number comparison
        const restrictionDay =
          typeof r.day_of_week === 'string'
            ? parseInt(r.day_of_week, 10)
            : r.day_of_week;

        return restrictionDay === dayOfWeek;
      }

      return false;
    });

    if (isHoliday) {
      throw new BadRequestException(
        'This day is a holiday. Please choose another date.',
      );
    }

    // 5. Check if time is in break
    // Logic replicated from GarageScheduleService.isTimeInBreak
    const slotStartTime = this.formatTime24Hour(startDateTime);
    const slotEndTime = this.formatTime24Hour(endDateTime);
    const slotStartMins = this.parseTimeToMinutes(slotStartTime);
    const slotEndMins = this.parseTimeToMinutes(slotEndTime);

    for (const restriction of restrictions) {
      if (restriction.type === 'BREAK') {
        // Check if break applies to this day
        let appliesToDay = false;
        if (Array.isArray(restriction.day_of_week)) {
          appliesToDay = restriction.day_of_week.includes(dayOfWeek);
        } else {
          const restrictionDay =
            typeof restriction.day_of_week === 'string'
              ? parseInt(restriction.day_of_week, 10)
              : restriction.day_of_week;
          appliesToDay = restrictionDay === dayOfWeek;
        }

        if (appliesToDay) {
          const breakStartMins = this.parseTimeToMinutes(
            restriction.start_time,
          );
          const breakEndMins = this.parseTimeToMinutes(restriction.end_time);

          // Check if slot overlaps with break
          // Overlap logic: (StartA < EndB) and (EndA > StartB)
          if (slotStartMins < breakEndMins && slotEndMins > breakStartMins) {
            throw new BadRequestException(
              `Cannot book during break time (${restriction.start_time} - ${restriction.end_time})`,
            );
          }
        }
      }
    }

    // 6. Check operating hours (Global vs Daily)
    let openTime = this.parseTimeToMinutes(schedule.start_time);
    let closeTime = this.parseTimeToMinutes(schedule.end_time);
    let validIntervals: { start: number; end: number }[] = [];

    // Check if daily_hours defines specific intervals for this day
    if (schedule.daily_hours) {
      const dailyHours =
        typeof schedule.daily_hours === 'string'
          ? JSON.parse(schedule.daily_hours)
          : schedule.daily_hours;

      const dayConfig = dailyHours[dayOfWeek.toString()];

      if (
        dayConfig &&
        Array.isArray(dayConfig.intervals) &&
        dayConfig.intervals.length > 0
      ) {
        // Use daily intervals
        validIntervals = dayConfig.intervals.map((interval: any) => ({
          start: this.parseTimeToMinutes(interval.start_time),
          end: this.parseTimeToMinutes(interval.end_time),
        }));
      }
    }

    // If no specific intervals, use global hours as a single interval
    if (validIntervals.length === 0) {
      validIntervals.push({ start: openTime, end: closeTime });
    }

    // Validate slot fits within at least one valid interval
    const fitsInInterval = validIntervals.some(
      (interval) =>
        slotStartMins >= interval.start && slotEndMins <= interval.end,
    );

    if (!fitsInInterval) {
      // Construct readable interval strings for error message
      const intervalStrings = validIntervals
        .map((i) => {
          const startStr = this.formatMinutesToTime(i.start);
          const endStr = this.formatMinutesToTime(i.end);
          return `${startStr} - ${endStr}`;
        })
        .join(', ');

      throw new BadRequestException(
        `Booking must be within operating hours: ${intervalStrings}`,
      );
    }

    // 7. Check slot duration
    const duration =
      (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60);
    if (duration < 15 || duration > 480) {
      throw new BadRequestException(
        'Slot duration must be between 15 minutes and 8 hours',
      );
    }
  }

  /**
   * Helper: Format time as HH:mm
   */
  private formatTime24Hour(date: Date): string {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  /**
   * Helper: Parse time to minutes
   */
  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Helper: Format minutes to HH:mm
   */
  private formatMinutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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
