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
import { MailService } from '../../../mail/mail.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    try {
      // ✅ NEW: Validate role_ids if provided
      if (createUserDto.role_ids && createUserDto.role_ids.length > 0) {
        const validRoles = await this.prisma.role.findMany({
          where: { id: { in: createUserDto.role_ids } },
          select: { id: true, name: true, title: true },
        });

        if (validRoles.length !== createUserDto.role_ids.length) {
          throw new BadRequestException('One or more role IDs are invalid');
        }

        // Validate that user type matches role requirements
        if (createUserDto.type === 'ADMIN') {
          const systemRoles = validRoles.filter((role) =>
            [
              'super_admin',
              'system_admin',
              'financial_admin',
              'operations_admin',
              'support_admin',
            ].includes(role.name),
          );
          if (systemRoles.length === 0) {
            throw new BadRequestException(
              'Admin users must be assigned at least one admin role',
            );
          }
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
      // Validate user exists before attempting to ban
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          approved_at: true,
          billing_id: true,
          type: true,
        },
      });

      if (!existingUser) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Check if user is already banned
      if (existingUser.approved_at === null) {
        return {
          success: false,
          message: 'User is already banned',
        };
      }

      // Ban user by setting approved_at to null (soft delete)
      const bannedUser = await this.prisma.user.update({
        where: { id },
        data: {
          approved_at: null,
          updated_at: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          approved_at: true,
          billing_id: true,
          type: true,
        },
      });

      // Handle role-based actions
      if (bannedUser.type === 'ADMIN') {
        // Admin users: No Stripe actions needed (no subscriptions)
        console.log(
          `Admin user ${bannedUser.email} banned - skipping Stripe actions`,
        );

        // Send admin-specific ban notification email
        await this.mailService.sendAdminBannedNotification({
          user: {
            name: bannedUser.name,
            email: bannedUser.email,
          },
          reason: 'Administrative action',
        });
      } else {
        // GARAGE/DRIVER users: Handle Stripe actions and send user notifications
        await this.handleUserBanStripeActions(bannedUser);

        // Send user ban notification email
        await this.mailService.sendUserBannedNotification({
          user: {
            name: bannedUser.name,
            email: bannedUser.email,
          },
          reason: 'Administrative action',
        });
      }

      return {
        success: true,
        message: 'User banned successfully',
        data: {
          user_id: bannedUser.id,
          email: bannedUser.email,
          name: bannedUser.name,
          banned_at: new Date(),
        },
      };
    } catch (error) {
      console.error('Error banning user:', error);
      return {
        success: false,
        message: 'Failed to ban user: ' + error.message,
      };
    }
  }

  /**
   * Unban user by restoring approved_at status
   * @param id - User ID to unban
   * @returns Success response with user details
   */
  async unbanUser(id: string) {
    try {
      // Validate user exists before attempting to unban
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          approved_at: true,
          billing_id: true,
          type: true,
        },
      });

      if (!existingUser) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Check if user is not banned (already active)
      if (existingUser.approved_at !== null) {
        return {
          success: false,
          message: 'User is not banned (already active)',
        };
      }

      // Unban user by setting approved_at to current date
      const unbannedUser = await this.prisma.user.update({
        where: { id },
        data: {
          approved_at: new Date(),
          updated_at: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          approved_at: true,
          billing_id: true,
          type: true,
        },
      });

      // Handle role-based actions
      if (unbannedUser.type === 'ADMIN') {
        // Admin users: No Stripe actions needed (no subscriptions)
        console.log(
          `Admin user ${unbannedUser.email} unbanned - skipping Stripe actions`,
        );

        // Send admin-specific unban notification email
        await this.mailService.sendAdminUnbannedNotification({
          user: {
            name: unbannedUser.name,
            email: unbannedUser.email,
          },
        });
      } else {
        // GARAGE/DRIVER users: Handle Stripe actions and send user notifications
        await this.handleUserUnbanStripeActions(unbannedUser);

        // Check if user had active subscriptions before ban (for email context)
        let hadSubscription = false;
        if (unbannedUser.billing_id) {
          try {
            const activeSubscriptions =
              await StripePayment.getActiveSubscriptions(
                unbannedUser.billing_id,
              );
            hadSubscription = activeSubscriptions.length > 0;
          } catch (error) {
            console.error('Error checking subscription history:', error);
            // Default to false if we can't check
          }
        }

        // Send user unban notification email
        await this.mailService.sendUserUnbannedNotification({
          user: {
            name: unbannedUser.name,
            email: unbannedUser.email,
          },
          hadSubscription: hadSubscription,
        });
      }

      return {
        success: true,
        message: 'User unbanned successfully',
        data: {
          user_id: unbannedUser.id,
          email: unbannedUser.email,
          name: unbannedUser.name,
          unbanned_at: new Date(),
        },
      };
    } catch (error) {
      console.error('Error unbanning user:', error);
      return {
        success: false,
        message: 'Failed to unban user: ' + error.message,
      };
    }
  }

  /**
   * Handle Stripe actions when user is banned
   * @param user - User object with billing_id
   */
  private async handleUserBanStripeActions(user: any) {
    try {
      // Skip if user doesn't have billing_id
      if (!user.billing_id) {
        console.log(
          `User ${user.email} has no billing_id, skipping Stripe actions`,
        );
        return;
      }

      console.log(`Handling Stripe actions for banned user: ${user.email}`);

      // Get active subscriptions for the customer
      const activeSubscriptions = await StripePayment.getActiveSubscriptions(
        user.billing_id,
      );

      if (activeSubscriptions.length > 0) {
        console.log(
          `Found ${activeSubscriptions.length} active subscriptions for user ${user.email}`,
        );

        // Cancel subscriptions at period end (graceful cancellation)
        for (const subscription of activeSubscriptions) {
          try {
            await StripePayment.cancelSubscriptionAtPeriodEnd(subscription.id);
            console.log(
              `Subscription ${subscription.id} will be cancelled at period end`,
            );
          } catch (error) {
            console.error(
              `Error cancelling subscription ${subscription.id}:`,
              error,
            );
            // Continue with other subscriptions even if one fails
          }
        }
      } else {
        console.log(`No active subscriptions found for user ${user.email}`);
      }

      // Update customer metadata to mark as banned
      await StripePayment.updateCustomerMetadata({
        customer_id: user.billing_id,
        metadata: {
          status: 'banned',
          banned_at: new Date().toISOString(),
          user_id: user.id,
        },
      });

      console.log(
        `Successfully updated Stripe customer metadata for banned user: ${user.email}`,
      );
    } catch (error) {
      console.error(
        `Error handling Stripe actions for banned user ${user.email}:`,
        error,
      );
      // Don't throw error to prevent ban operation from failing
      // Log the error and continue with the ban process
    }
  }

  /**
   * Handle Stripe actions when user is unbanned
   * @param user - User object with billing_id
   */
  private async handleUserUnbanStripeActions(user: any) {
    try {
      // Skip if user doesn't have billing_id
      if (!user.billing_id) {
        console.log(
          `User ${user.email} has no billing_id, skipping Stripe actions`,
        );
        return;
      }

      console.log(`Handling Stripe actions for unbanned user: ${user.email}`);

      // Update customer metadata to mark as active
      await StripePayment.updateCustomerMetadata({
        customer_id: user.billing_id,
        metadata: {
          status: 'active',
          unbanned_at: new Date().toISOString(),
          user_id: user.id,
          previous_status: 'banned',
        },
      });

      console.log(
        `Successfully updated Stripe customer metadata for unbanned user: ${user.email}`,
      );

      // Note: We don't automatically reactivate subscriptions
      // User must manually resubscribe if they want paid features
      console.log(
        `User ${user.email} can manually resubscribe for paid features`,
      );
    } catch (error) {
      console.error(
        `Error handling Stripe actions for unbanned user ${user.email}:`,
        error,
      );
      // Don't throw error to prevent unban operation from failing
      // Log the error and continue with the unban process
    }
  }

  async assignRoles(userId: string, roleIds: string[]) {
    try {
      // Validate user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, type: true },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Validate roles exist
      const validRoles = await this.prisma.role.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, name: true, title: true },
      });

      if (validRoles.length !== roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }

      // Validate that admin users get admin roles
      if (user.type === 'ADMIN') {
        const systemRoles = validRoles.filter((role) =>
          [
            'super_admin',
            'system_admin',
            'financial_admin',
            'operations_admin',
            'support_admin',
          ].includes(role.name),
        );
        if (systemRoles.length === 0) {
          throw new BadRequestException(
            'Admin users must be assigned at least one admin role',
          );
        }
      }

      // Remove existing role assignments
      await this.prisma.roleUser.deleteMany({
        where: { user_id: userId },
      });

      // Create new role assignments
      await this.prisma.roleUser.createMany({
        data: roleIds.map((roleId) => ({
          user_id: userId,
          role_id: roleId,
        })),
      });

      // Return updated user with roles
      const updatedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          type: true,
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

      const formattedRoles = updatedUser.role_users.map((ru) => ({
        id: ru.role.id,
        title: ru.role.title,
        name: ru.role.name,
        created_at: ru.role.created_at,
      }));

      return {
        success: true,
        message: 'User roles updated successfully',
        data: {
          ...updatedUser,
          roles: formattedRoles,
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

  async removeRole(userId: string, roleId: string) {
    try {
      // Validate user and role exist
      const [user, role] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, type: true },
        }),
        this.prisma.role.findUnique({
          where: { id: roleId },
          select: { id: true, name: true },
        }),
      ]);

      if (!user) throw new BadRequestException('User not found');
      if (!role) throw new BadRequestException('Role not found');

      // Prevent removing last admin role from admin users
      if (user.type === 'ADMIN') {
        const remainingRoles = await this.prisma.roleUser.findMany({
          where: { user_id: userId },
          include: {
            role: {
              select: { name: true },
            },
          },
        });

        const adminRoles = remainingRoles.filter((ru) =>
          [
            'super_admin',
            'system_admin',
            'financial_admin',
            'operations_admin',
            'support_admin',
          ].includes(ru.role.name),
        );

        const removingAdminRole = [
          'super_admin',
          'system_admin',
          'financial_admin',
          'operations_admin',
          'support_admin',
        ].includes(role.name);

        if (removingAdminRole && adminRoles.length <= 1) {
          throw new BadRequestException(
            'Cannot remove the last admin role from an admin user',
          );
        }
      }

      await this.prisma.roleUser.deleteMany({
        where: {
          user_id: userId,
          role_id: roleId,
        },
      });

      return {
        success: true,
        message: 'Role removed successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
