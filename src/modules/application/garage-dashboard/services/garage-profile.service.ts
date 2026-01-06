import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UpdateGarageProfileDto } from '../dto/update-garage-profile.dto';
import { SojebStorage } from '../../../../common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { memoryStorage } from 'multer';

type LatLng = {
  lat: number;
  lng: number;
  outcode?: string;
  postcodeDisplay?: string;
};
@Injectable()
export class GarageProfileService {
  private readonly logger = new Logger(GarageProfileService.name);
  private readonly storage = new SojebStorage();

  constructor(private prisma: PrismaService) {}

  /**
   * Get garage profile
   */
  async getProfile(userId: string) {
    try {
      this.logger.log(`Fetching profile for garage user ${userId}`);

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          email: true,
          vts_number: true,
          // primary_contact: true,
          phone_number: true,
          avatar: true,
          first_name: true,
          last_name: true,
          created_at: true,
          updated_at: true,
        },
      });

      const avatarUrl = SojebStorage.url(
        appConfig().storageUrl.avatar + user.avatar,
      );

      if (!user) {
        throw new NotFoundException('Garage profile not found');
      }

      // Calculate total amount from completed orders
      const totalAmount = await this.calculateTotalAmount(userId);

      return {
        success: true,
        message: 'Garage profile retrieved successfully',
        data: {
          ...user,
          total_amount: totalAmount,
          avatar_url: avatarUrl,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get profile for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update garage profile
   */
  async updateProfile(
    userId: string,
    dto: UpdateGarageProfileDto,
    avatar?: Express.Multer.File,
  ) {
    try {
      this.logger.log(`Updating profile for garage user ${userId}`);

      // Validate user exists and is a garage
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { type: true, avatar: true },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }
      if (existingUser.type !== 'GARAGE') {
        throw new BadRequestException('User is not a garage');
      }
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (dto.zip_code) {
        const { lat, lng } = await this.getLatLng(dto.zip_code);
        latitude = lat;
        longitude = lng;
      }
      // Prepare update data (skip email)
      const data: any = {};
      if (dto.garage_name) data.garage_name = dto.garage_name;
      if (dto.address) data.address = dto.address;
      if (dto.zip_code) data.zip_code = dto.zip_code;
      if (dto.vts_number) data.vts_number = dto.vts_number;
      if (dto.primary_contact) data.primary_contact = dto.primary_contact;
      if (dto.phone_number) data.phone_number = dto.phone_number;
      if (latitude) data.latitude = latitude;
      if (longitude) data.longitude = longitude;

      // Handle avatar upload
      if (avatar) {
        // Delete old avatar if exists
        if (existingUser.avatar) {
          await SojebStorage.delete(
            appConfig().storageUrl.avatar + existingUser.avatar,
          );
        }
        // Generate a random file name
        const randomName = Array(32)
          .fill(null)
          .map(() => Math.round(Math.random() * 16).toString(16))
          .join('');
        const fileName = `${randomName}${avatar.originalname}`;
        await SojebStorage.put(
          appConfig().storageUrl.avatar + fileName,
          avatar.buffer,
        );
        data.avatar = fileName;
      }

      // Update user
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          vts_number: true,
          primary_contact: true,
          phone_number: true,
          avatar: true,
          updated_at: true,
        },
      });

      // Get public URL for avatar if present
      let avatarUrl = undefined;
      if (updatedUser.avatar) {
        avatarUrl = SojebStorage.url(
          appConfig().storageUrl.avatar + updatedUser.avatar,
        );
      }

      return {
        success: true,
        message: 'Garage profile updated successfully',
        data: {
          ...updatedUser,
          avatar_url: avatarUrl,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to update profile for user ${userId}:`, error);
      throw error;
    }
  }
  private normalizeUkPostcode(input: string): string {
    return (input || '').trim().toUpperCase().replace(/\s+/g, '');
  }
  async getLatLng(postcode: string): Promise<LatLng> {
    const raw = (postcode || '').trim();
    if (!raw) throw new BadRequestException('Invalid postcode');

    const normalized = this.normalizeUkPostcode(raw);

    // 1) DB cache hit
    const cached = await this.prisma.postcodeGeoCache.findUnique({
      where: { postcodeNormalized: normalized },
      select: {
        latitude: true,
        longitude: true,
        outcode: true,
        postcodeDisplay: true,
      },
    });

    if (cached) {
      return {
        lat: cached.latitude,
        lng: cached.longitude,
        outcode: cached.outcode ?? undefined,
        postcodeDisplay: cached.postcodeDisplay ?? undefined,
      };
    }

    // 2) Cache miss -> external lookup
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`;
    const response = await fetch(url);

    if (!response.ok) {
      this.logger.warn(
        `Postcode API failed: ${response.status} ${response.statusText}`,
      );
      throw new BadRequestException('Invalid postcode');
    }

    const data = await response.json();
    const result = data?.result;

    const lat = result?.latitude;
    const lng = result?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new BadRequestException('Invalid postcode');
    }

    const outcode: string | undefined = result?.outcode ?? undefined;
    const postcodeDisplay: string | undefined = result?.postcode ?? undefined;

    // 3) Upsert cache
    await this.prisma.postcodeGeoCache.upsert({
      where: { postcodeNormalized: normalized },
      create: {
        postcodeNormalized: normalized,
        postcodeDisplay,
        latitude: lat,
        longitude: lng,
        outcode,
        source: 'postcodes.io',
      },
      update: {
        postcodeDisplay,
        latitude: lat,
        longitude: lng,
        outcode,
        source: 'postcodes.io',
      },
    });

    return { lat, lng, outcode, postcodeDisplay };
  }

  /**
   * Upload garage avatar
   */
  // async uploadAvatar(userId: string, file: Express.Multer.File) {
  //   try {
  //     this.logger.log(`Uploading avatar for garage user ${userId}`);

  //     // Validate user exists and is a garage
  //     const existingUser = await this.prisma.user.findUnique({
  //       where: { id: userId },
  //       select: { type: true, avatar: true },
  //     });

  //     if (!existingUser) {
  //       throw new NotFoundException('User not found');
  //     }

  //     if (existingUser.type !== 'GARAGE') {
  //       throw new BadRequestException('User is not a garage');
  //     }

  //     // Delete old avatar if exists
  //     if (existingUser.avatar) {
  //       await SojebStorage.delete(
  //         appConfig().storageUrl.avatar + existingUser.avatar,
  //       );
  //     }

  //     // Generate a random file name
  //     const randomName = Array(32)
  //       .fill(null)
  //       .map(() => Math.round(Math.random() * 16).toString(16))
  //       .join('');
  //     const fileName = `${randomName}${file.originalname}`;

  //     // Upload file to storage
  //     await SojebStorage.put(
  //       appConfig().storageUrl.avatar + fileName,
  //       file.buffer,
  //     );

  //     // Update user avatar (save only the file name or path)
  //     const updatedUser = await this.prisma.user.update({
  //       where: { id: userId },
  //       data: { avatar: fileName },
  //       select: {
  //         id: true,
  //         avatar: true,
  //         updated_at: true,
  //       },
  //     });

  //     // Get public URL
  //     const avatarUrl = SojebStorage.url(
  //       appConfig().storageUrl.avatar + fileName,
  //     );

  //     this.logger.log(`Avatar uploaded successfully for user ${userId}`);

  //     return {
  //       success: true,
  //       message: 'Avatar uploaded successfully',
  //       data: {
  //         avatar_url: avatarUrl,
  //       },
  //     };
  //   } catch (error) {
  //     this.logger.error(`Failed to upload avatar for user ${userId}:`, error);
  //     throw error;
  //   }
  // }

  /**
   * Calculate total amount from completed orders
   */
  private async calculateTotalAmount(userId: string): Promise<number> {
    const result = await this.prisma.order.aggregate({
      where: {
        garage_id: userId,
        status: 'COMPLETED',
      },
      _sum: {
        total_amount: true,
      },
    });

    return Number(result._sum.total_amount || 0);
  }
}
