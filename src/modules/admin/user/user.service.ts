import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserRepository } from '../../../common/repository/user/user.repository';
import appConfig from '../../../config/app.config';
import { SojebStorage } from '../../../common/lib/Disk/SojebStorage';
import { DateHelper } from '../../../common/helper/date.helper';
import { Role } from 'src/common/guard/role/role.enum';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      // ✅ NEW: Validate role_ids if provided
      if (createUserDto.role_ids && createUserDto.role_ids.length > 0) {
        const validRoles = await this.prisma.role.findMany({
          where: { id: { in: createUserDto.role_ids } },
        });

        if (validRoles.length !== createUserDto.role_ids.length) {
          throw new BadRequestException('One or more role IDs are invalid');
        }
      }

      // ✅ NEW: Create user with transaction to ensure data consistency
      const result = await this.prisma.$transaction(async (tx) => {
        // Create the user
        const user = await UserRepository.createUser({
          ...createUserDto,
          type: createUserDto.type as Role,
        });

        if (!user.success) {
          throw new BadRequestException(user.message);
        }

        // ✅ NEW: Auto-verify and approve admin users
        if (createUserDto.type === 'ADMIN') {
          await tx.user.update({
            where: { id: user.data.id },
            data: {
              email_verified_at: new Date(), // Auto-verify admin email
              approved_at: new Date(), // Auto-approve admin
            },
          });
        }

        // ✅ NEW: Create Stripe customer for admin users
        if (createUserDto.type === 'ADMIN') {
          try {
            const stripeCustomer = await StripePayment.createCustomer({
              user_id: user.data.id,
              email: createUserDto.email,
              name: createUserDto.name,
            });

            if (stripeCustomer) {
              await tx.user.update({
                where: { id: user.data.id },
                data: { billing_id: stripeCustomer.id },
              });
            }
          } catch (stripeError) {
            console.warn(
              'Stripe customer creation failed:',
              stripeError.message,
            );
            // Don't fail the user creation if Stripe fails
          }
        }

        // ✅ NEW: Assign roles if provided
        if (createUserDto.role_ids && createUserDto.role_ids.length > 0) {
          const roleAssignments = createUserDto.role_ids.map((roleId) => ({
            user_id: user.data.id,
            role_id: roleId,
          }));

          await tx.roleUser.createMany({
            data: roleAssignments,
          });
        }

        // ✅ FIXED: Fetch complete user data with roles using correct relation name
        const completeUser = await tx.user.findUnique({
          where: { id: user.data.id },
          select: {
            id: true,
            name: true,
            email: true,
            type: true,
            phone_number: true,
            address: true,
            avatar: true,
            email_verified_at: true,
            approved_at: true,
            created_at: true,
            updated_at: true,
            billing_id: true,
            // ✅ FIXED: Use correct relation name 'role_users' instead of 'roles'
            role_users: {
              include: {
                role: {
                  select: {
                    id: true,
                    title: true,
                    name: true,
                    created_at: true,
                  },
                },
              },
            },
          },
        });

        return completeUser;
      });

      // ✅ NEW: Add avatar URL if exists
      if (result.avatar) {
        result['avatar_url'] = SojebStorage.url(
          appConfig().storageUrl.avatar + result.avatar,
        );
      }

      // ✅ FIXED: Format roles for response using correct relation name
      const formattedRoles = result.role_users.map((ru) => ({
        id: ru.role.id,
        title: ru.role.title,
        name: ru.role.name,
        created_at: ru.role.created_at,
      }));

      return {
        success: true,
        message: 'User created successfully',
        data: {
          ...result,
          roles: formattedRoles,
          // ✅ NEW: Remove the role_users field from response
          role_users: undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findAll({
    q,
    type,
    approved,
  }: {
    q?: string;
    type?: string;
    approved?: string;
  }) {
    try {
      const where_condition = {};
      if (q) {
        where_condition['OR'] = [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ];
      }

      if (type) {
        where_condition['type'] = type;
      }

      if (approved) {
        where_condition['approved_at'] =
          approved == 'approved' ? { not: null } : { equals: null };
      }

      const users = await this.prisma.user.findMany({
        where: {
          ...where_condition,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          address: true,
          type: true,
          approved_at: true,
          created_at: true,
          updated_at: true,
        },
      });

      return {
        success: true,
        data: users,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          type: true,
          phone_number: true,
          approved_at: true,
          created_at: true,
          updated_at: true,
          avatar: true,
          billing_id: true,
        },
      });

      // add avatar url to user
      if (user.avatar) {
        user['avatar_url'] = SojebStorage.url(
          appConfig().storageUrl.avatar + user.avatar,
        );
      }

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      return {
        success: true,
        data: user,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async approve(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: id },
      });
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      await this.prisma.user.update({
        where: { id: id },
        data: { approved_at: DateHelper.now() },
      });
      return {
        success: true,
        message: 'User approved successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async reject(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: id },
      });
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      await this.prisma.user.update({
        where: { id: id },
        data: { approved_at: null },
      });
      return {
        success: true,
        message: 'User rejected successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const user = await UserRepository.updateUser(id, updateUserDto);

      if (user.success) {
        return {
          success: user.success,
          message: user.message,
        };
      } else {
        return {
          success: user.success,
          message: user.message,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async remove(id: string) {
    try {
      const user = await UserRepository.deleteUser(id);
      return user;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
