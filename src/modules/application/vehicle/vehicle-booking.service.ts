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
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class VehicleBookingService {
  private readonly logger = new Logger(VehicleBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleService: VehicleService,
    private readonly vehicleGarageService: VehicleGarageService,
    private readonly garageScheduleService: GarageScheduleService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
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

  // --------------------------------------- New Added By Najim------------------------------------

  async getGarages(query: SearchGarageDto, user_id?: string) {
    const vehicleInfo = await this.validateVehicleWithDVLA(
      query.registration_number,
    );
    if (!vehicleInfo) {
      throw new BadRequestException('Vehicle not found');
    }
    if (user_id) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: {
          user_id: user_id,
          registration_number: query.registration_number.toUpperCase(),
        },
        select: {
          id: true,
        },
      });
      let vehicleId: string;
      if (!vehicle && user_id) {
        const vehicleResponse = await this.vehicleService.addVehicle(user_id, {
          registration_number: query.registration_number,
        });
        vehicleId = vehicleResponse.data.id;
      }
      vehicleInfo.vehicle_id = vehicle?.id || vehicleId;
    }
    const garagesWithCount =
      await this.vehicleGarageService.findActiveGaragesWithPagination(
        query.postcode,
        query.limit,
        query.page,
        query.sort_by,
      );
    return {
      success: true,
      data: {
        vehicle: vehicleInfo,
        garages: garagesWithCount.garages,
      },
      meta_data: {
        page: query.page || 1,
        limit: query.limit || 10,
        total_count: garagesWithCount.total_count,
        search_postcode: query.postcode,
      },
    };
  }

  // --------------------------------------- New Added By Najim------------------------------------

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

      let booking;
      if (bookingData.slot_id) {
        // ID-based booking (existing database slot)
        booking = await this.bookExistingSlot(userId, bookingData, service);
      } else {
        // Time-based booking (template slot - create and book atomically)
        booking = await this.bookTemplateSlot(userId, bookingData, service);
      }

      await this.notificationService.create({
        receiver_id: bookingData.garage_id,
        sender_id: userId,
        type: NotificationType.BOOKING,
        text: `New booking received for ${bookingData.service_type} service`,
        entity_id: booking.data.order_id,
        actions: [
          {
            label: 'Accept',
            action: 'accept_booking',
            variant: 'success',
          },
          {
            label: 'Reject',
            action: 'reject_booking',
            variant: 'danger',
          },
        ],
      });

      // Send emails (fire-and-forget; don't block booking response)
      this.sendBookingEmails(userId, bookingData, booking);

      return booking
        ? booking
        : {
            success: false,
            message: 'Booking failed',
          };
    } catch (error) {
      this.logger.error(`Error booking slot: ${error.message}`, error.stack);

      // If it's a known NestJS exception (BadRequest, NotFound, Conflict), throw as-is
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      // For any other error (including deadlock/transaction errors), return error response
      throw new BadRequestException(
        error.message || 'Failed to book slot. Please try again.',
      );
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
   * Book a template slot (atomic create + book with race protection and retry logic)
   */
  private async bookTemplateSlot(
    userId: string,
    bookingData: BookSlotDto,
    service: any,
  ): Promise<any> {
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.executeTemplateSlotBooking(
          userId,
          bookingData,
          service,
        );
      } catch (error: any) {
        lastError = error;

        // Check if it's a deadlock/write conflict error
        const isDeadlock =
          error.code === 'P2034' || // Write conflict
          error.message?.includes('write conflict') ||
          error.message?.includes('deadlock');

        if (isDeadlock && attempt < maxRetries - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delay = 100 * Math.pow(2, attempt);
          this.logger.warn(
            `Deadlock detected on attempt ${attempt + 1}/${maxRetries}. Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // If it's not a deadlock or we've exhausted retries, throw the error
        throw error;
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
  }

  /**
   * Execute the actual template slot booking transaction
   */
  private async executeTemplateSlotBooking(
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

        // Try to find or create the slot atomically
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

  private async validateSlotIsBookable(
    garageId: string,
    startDateTime: Date,
    endDateTime: Date,
    tx: any,
  ): Promise<void> {
    const schedule = await tx.schedule.findUnique({
      where: { garage_id: garageId },
    });

    if (!schedule?.is_active) {
      throw new BadRequestException('Garage schedule not active');
    }

    if (startDateTime < new Date()) {
      throw new BadRequestException('Cannot book past dates');
    }

    const dayOfWeek = startDateTime.getDay();
    const dailyHours = this.parseDailyHours(schedule.daily_hours);
    const dayConfig = dailyHours?.[dayOfWeek];

    if (dayConfig?.is_closed) {
      throw new BadRequestException('Garage closed on this day');
    }

    const restrictions = Array.isArray(schedule.restrictions)
      ? schedule.restrictions
      : JSON.parse(schedule.restrictions || '[]');

    this.checkHoliday(restrictions, startDateTime, dayOfWeek);
    this.checkBreakTime(restrictions, startDateTime, endDateTime, dayOfWeek);
    this.checkOperatingHours(
      schedule,
      startDateTime,
      endDateTime,
      dayOfWeek,
      dayConfig,
    );
    this.checkSlotDuration(startDateTime, endDateTime);
  }

  private parseDailyHours(dailyHours: any): any {
    if (!dailyHours) return null;
    return typeof dailyHours === 'string' ? JSON.parse(dailyHours) : dailyHours;
  }

  private checkHoliday(
    restrictions: any[],
    startDateTime: Date,
    dayOfWeek: number,
  ): void {
    const dateStr = startDateTime.toISOString().split('T')[0];
    const month = startDateTime.getMonth() + 1;
    const day = startDateTime.getDate();

    const isHoliday = restrictions.some((r) => {
      if (r.type !== 'HOLIDAY') return false;
      if (r.date === dateStr) return true;
      if (r.month !== undefined && r.day !== undefined) {
        if (r.month === month && r.day === day) return true;
      }
      return this.matchesDayOfWeek(r.day_of_week, dayOfWeek);
    });

    if (isHoliday) {
      throw new BadRequestException('Cannot book on holidays');
    }
  }

  private checkBreakTime(
    restrictions: any[],
    startDateTime: Date,
    endDateTime: Date,
    dayOfWeek: number,
  ): void {
    const startMins = this.parseTimeToMinutes(
      this.formatTime24Hour(startDateTime),
    );
    const endMins = this.parseTimeToMinutes(this.formatTime24Hour(endDateTime));

    for (const r of restrictions) {
      if (
        r.type === 'BREAK' &&
        this.matchesDayOfWeek(r.day_of_week, dayOfWeek)
      ) {
        const breakStart = this.parseTimeToMinutes(r.start_time);
        const breakEnd = this.parseTimeToMinutes(r.end_time);

        if (startMins < breakEnd && endMins > breakStart) {
          throw new BadRequestException(
            `Cannot book during break (${r.start_time}-${r.end_time})`,
          );
        }
      }
    }
  }

  private checkOperatingHours(
    schedule: any,
    startDateTime: Date,
    endDateTime: Date,
    dayOfWeek: number,
    dayConfig: any,
  ): void {
    const startMins = this.parseTimeToMinutes(
      this.formatTime24Hour(startDateTime),
    );
    const endMins = this.parseTimeToMinutes(this.formatTime24Hour(endDateTime));

    let intervals: { start: number; end: number }[] = [];

    if (dayConfig?.intervals?.length) {
      intervals = dayConfig.intervals.map((i: any) => ({
        start: this.parseTimeToMinutes(i.start_time),
        end: this.parseTimeToMinutes(i.end_time),
      }));
    } else {
      intervals = [
        {
          start: this.parseTimeToMinutes(schedule.start_time),
          end: this.parseTimeToMinutes(schedule.end_time),
        },
      ];
    }

    const valid = intervals.some(
      (i) => startMins >= i.start && endMins <= i.end,
    );

    if (!valid) {
      const times = intervals
        .map(
          (i) =>
            `${this.formatMinutesToTime(i.start)}-${this.formatMinutesToTime(i.end)}`,
        )
        .join(', ');
      throw new BadRequestException(`Must be within hours: ${times}`);
    }
  }

  private checkSlotDuration(startDateTime: Date, endDateTime: Date): void {
    const mins = (endDateTime.getTime() - startDateTime.getTime()) / 60000;
    if (mins < 15 || mins > 480) {
      throw new BadRequestException('Duration must be 15min-8hrs');
    }
  }

  private matchesDayOfWeek(restrictionDay: any, dayOfWeek: number): boolean {
    if (restrictionDay === undefined || restrictionDay === null) return false;
    if (Array.isArray(restrictionDay))
      return restrictionDay.includes(dayOfWeek);
    const day =
      typeof restrictionDay === 'string'
        ? parseInt(restrictionDay)
        : restrictionDay;
    return day === dayOfWeek;
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

  // Helper to compose and send booking emails to driver and garage
  private async sendBookingEmails(
    userId: string,
    bookingData: BookSlotDto,
    bookingResult: any,
  ) {
    try {
      // Fetch driver and garage contact details
      const [driver, garage, slot] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.user.findUnique({ where: { id: bookingData.garage_id } }),
        this.prisma.timeSlot.findUnique({
          where: { id: bookingResult.data.slot_id },
        }),
      ]);

      if (!driver || !garage || !slot) return;

      const start = new Date(slot.start_datetime);
      const end = new Date(slot.end_datetime);
      const booking_date = start.toLocaleDateString('en-GB');
      const booking_time = `${start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

      // Fetch vehicle and service label if needed
      const [vehicle] = await Promise.all([
        this.prisma.vehicle.findUnique({
          where: { id: bookingData.vehicle_id },
        }),
      ]);

      const service_type = bookingData.service_type;
      const vehicle_registration = vehicle?.registration_number || '';

      // Driver email
      if (driver?.email) {
        this.mailService.sendBookingConfirmationToDriver({
          to: driver.email,
          driver_name: driver.name || 'Driver',
          garage_name: garage.garage_name || 'Garage',
          service_type,
          vehicle_registration,
          booking_date,
          booking_time,
        });
      }

      // Garage email
      if (garage?.email) {
        this.mailService.sendBookingNotificationToGarage({
          to: garage.email,
          driver_name: driver?.name || 'Driver',
          garage_name: garage.garage_name || 'Garage',
          service_type,
          vehicle_registration,
          booking_date,
          booking_time,
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to queue booking emails: ${err?.message}`);
    }
  }
}
