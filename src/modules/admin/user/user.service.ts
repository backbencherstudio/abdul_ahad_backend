import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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
import { NotificationService } from '../../application/notification/notification.service';
import { NotificationType } from '../../../common/repository/notification/notification.repository';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  // ✅ ROLE HIERARCHY: Define role levels for smart replacement
  private readonly roleHierarchy = {
    super_admin: 5,
    system_admin: 4,
    operations_admin: 3,
    financial_admin: 3,
    support_admin: 2,
  };

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notificationService: NotificationService,
  ) {}

  async create(createUserDto: CreateUserDto, currentUserId?: string) {
    try {
      // ✅ SECURITY: Validate role_ids if provided
      if (createUserDto.role_ids && createUserDto.role_ids.length > 0) {
        const validRoles = await this.prisma.role.findMany({
          where: { id: { in: createUserDto.role_ids } },
          select: { id: true, name: true, title: true },
        });

        if (validRoles.length !== createUserDto.role_ids.length) {
          throw new BadRequestException('One or more role IDs are invalid');
        }

        // ✅ SECURITY: Prevent Super Admin role assignment via user creation
        const superAdminRole = validRoles.find(
          (role) => role.name === 'super_admin',
        );
        if (superAdminRole) {
          this.logger.warn(
            `Security violation prevented: Super Admin assignment attempt during user creation`,
          );
          throw new BadRequestException(
            'Super Admin role cannot be assigned via user creation. Use system administrator tools.',
          );
        }

        // ✅ SECURITY: Only Super Admin can assign critical roles
        const criticalRoles = ['system_admin'];
        const hasCriticalRoles = validRoles.some((role) =>
          criticalRoles.includes(role.name),
        );

        if (hasCriticalRoles && currentUserId) {
          const currentUserRoles = await this.prisma.roleUser.findMany({
            where: { user_id: currentUserId },
            include: { role: { select: { name: true } } },
          });

          const isSuperAdmin = currentUserRoles.some(
            (ru) => ru.role.name === 'super_admin',
          );

          if (!isSuperAdmin) {
            this.logger.warn(
              `Security violation prevented: Non-super-admin attempted to assign critical roles during user creation`,
            );
            throw new BadRequestException(
              'Insufficient permissions. Only Super Admin can assign critical roles.',
            );
          }
        } else if (hasCriticalRoles && !currentUserId) {
          throw new BadRequestException(
            'Cannot verify permissions. Critical role assignment requires Super Admin privileges.',
          );
        }

        // ✅ SECURITY: Prevent self-assignment of critical roles
        if (hasCriticalRoles && currentUserId) {
          const currentUser = await this.prisma.user.findUnique({
            where: { id: currentUserId },
            select: { email: true },
          });

          if (currentUser && currentUser.email === createUserDto.email) {
            this.logger.warn(
              `Security violation prevented: Self-assignment of critical roles attempted during user creation`,
            );
            throw new BadRequestException(
              'Cannot assign critical roles to yourself. Use system administrator tools.',
            );
          }
        }

        // Validate that user type matches role requirements
        if (createUserDto.type === 'ADMIN') {
          const systemRoles = validRoles.filter((role) =>
            [
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

      // ✅ SECURITY: Apply intelligent role assignment logic (outside transaction for variable scope)
      let rolesToAdd: Array<{ id: string; name: string }> = [];
      let rolesToRemove: Array<{ id: string; name: string }> = [];
      let strategy = 'none';
      let reasoning = 'No roles assigned';

      if (createUserDto.role_ids && createUserDto.role_ids.length > 0) {
        const validRoles = await this.prisma.role.findMany({
          where: { id: { in: createUserDto.role_ids } },
          select: { id: true, name: true, title: true },
        });

        // Apply intelligent role assignment logic (same as role assignment endpoint)
        const {
          rolesToAdd: selectedRoles,
          rolesToRemove: removedRoles,
          strategy: assignmentStrategy,
          reasoning: assignmentReasoning,
        } = this.calculateRoleChanges(
          [], // Empty array - new user has no existing roles
          validRoles,
        );

        rolesToAdd = selectedRoles;
        rolesToRemove = removedRoles;
        strategy = assignmentStrategy;
        reasoning = assignmentReasoning;
      }

      // ✅ SECURITY: Create user with transaction to ensure data consistency
      const result = await this.prisma.$transaction(async (tx) => {
        // Create the user
        const user = await UserRepository.createUser({
          ...createUserDto,
          type: createUserDto.type as Role,
        });

        if (!user.success) {
          throw new BadRequestException(user.message);
        }

        // ✅ NEW: Auto-verify and approve ALL admin-created users
        // Admin takes responsibility for user data validation
        await tx.user.update({
          where: { id: user.data.id },
          data: {
            email_verified_at: new Date(), // Auto-verify all admin-created users
            approved_at: new Date(), // Auto-approve all admin-created users
          },
        });

        // ✅ NEW: Create Stripe customer only for DRIVER and GARAGE users
        // ADMIN users don't need Stripe integration (internal users)
        if (
          createUserDto.type === 'DRIVER' ||
          createUserDto.type === 'GARAGE'
        ) {
          try {
            const stripeCustomer = await StripePayment.createCustomer({
              user_id: user.data.id,
              email: createUserDto.email,
              name: createUserDto.name || createUserDto.primary_contact,
            });

            if (stripeCustomer) {
              await tx.user.update({
                where: { id: user.data.id },
                data: { billing_id: stripeCustomer.id },
              });
            }
          } catch (stripeError) {
            this.logger.warn(
              'Stripe customer creation failed:',
              stripeError.message,
            );
            // Don't fail the user creation if Stripe fails
          }
        }

        // ✅ SECURITY: Assign roles using intelligent selection
        if (rolesToAdd.length > 0) {
          const roleAssignments = rolesToAdd.map((role) => ({
            user_id: user.data.id,
            role_id: role.id,
          }));

          await tx.roleUser.createMany({
            data: roleAssignments,
          });

          // ✅ AUDIT: Log intelligent role assignment
          this.logger.log(
            `User creation with intelligent role assignment: User ${user.data.id}, Strategy: ${strategy}, Added: ${rolesToAdd.map((r) => r.name).join(', ')}, Reasoning: ${reasoning}`,
          );
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

      // ✅ NEW: Generate user-type-specific response
      const userType = createUserDto.type.toLowerCase();
      const actionsPerformed = [
        'Account auto-verified',
        'Account auto-approved',
        'User can login immediately',
      ];

      // Add Stripe-specific actions for DRIVER/GARAGE users
      if (createUserDto.type === 'DRIVER' || createUserDto.type === 'GARAGE') {
        if (result.billing_id) {
          actionsPerformed.push('Stripe customer created');
        } else {
          actionsPerformed.push('Stripe customer creation attempted');
        }
      }

      // Add role-specific actions for ADMIN users
      if (createUserDto.type === 'ADMIN' && formattedRoles.length > 0) {
        actionsPerformed.push('Admin roles assigned');
      }

      // ✅ ENHANCED: Generate smart response message based on role assignment
      let message = `${createUserDto.type} user created successfully`;
      if (rolesToAdd.length > 0) {
        message += ` with ${rolesToAdd.length} role(s) assigned`;
      }

      return {
        success: true,
        message: message,
        data: {
          id: result.id,
          email: result.email,
          name: result.name,
          type: result.type,
          email_verified_at: result.email_verified_at,
          approved_at: result.approved_at,
          billing_id: result.billing_id,
          roles: formattedRoles,
          created_at: result.created_at,
          // ✅ ENHANCED: Add role assignment details (consistent with role assignment endpoint)
          roles_added: rolesToAdd.length,
          roles_removed: rolesToRemove.length,
          assignment_strategy: strategy,
          intelligent_reasoning: reasoning,
          actions_performed: actionsPerformed,
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
    page = '1',
    limit = '20',
  }: {
    q?: string;
    type?: string;
    approved?: string;
    page?: string;
    limit?: string;
  }) {
    try {
      // ✅ ENHANCED: Parse and validate pagination parameters
      const p = parseInt(page, 10);
      const l = parseInt(limit, 10);

      if (isNaN(p) || isNaN(l) || p < 1 || l < 1) {
        throw new BadRequestException('Invalid page or limit parameters');
      }

      if (l > 100) {
        throw new BadRequestException(
          'Limit cannot exceed 100 records per page',
        );
      }

      // ✅ ENHANCED: Build where condition
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

      // ✅ ENHANCED: Calculate pagination
      const skip = (p - 1) * l;

      // ✅ ENHANCED: Get paginated results, total count, and user statistics in parallel
      const [
        users,
        total,
        totalUsers,
        totalBannedUsers,
        totalAdminUsers,
        totalGarageUsers,
        totalDriverUsers,
        totalApprovedUsers,
      ] = await Promise.all([
        this.prisma.user.findMany({
          where: {
            ...where_condition,
          },
          skip,
          take: l,
          orderBy: { created_at: 'desc' },
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
            avatar: true,
            // ✅ NEW: Include user roles
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
        }),
        this.prisma.user.count({
          where: {
            ...where_condition,
          },
        }),
        // ✅ NEW: User statistics queries
        this.prisma.user.count(),
        this.prisma.user.count({
          where: { approved_at: null },
        }),
        this.prisma.user.count({
          where: { type: 'ADMIN' },
        }),
        this.prisma.user.count({
          where: { type: 'GARAGE' },
        }),
        this.prisma.user.count({
          where: { type: 'DRIVER' },
        }),
        this.prisma.user.count({
          where: { approved_at: { not: null } },
        }),
      ]);

      // ✅ ENHANCED: Generate avatar URLs and format roles
      const usersWithAvatarUrls = users.map((user) => {
        const userData = { ...user };

        // Generate avatar_url from avatar field
        if (user.avatar) {
          userData['avatar_url'] = SojebStorage.url(
            appConfig().storageUrl.avatar + user.avatar,
          );
        } else {
          userData['avatar_url'] = null;
        }

        // ✅ NEW: Format roles for response
        if (user.role_users && user.role_users.length > 0) {
          userData['roles'] = user.role_users.map((ru) => ({
            id: ru.role.id,
            title: ru.role.title,
            name: ru.role.name,
            created_at: ru.role.created_at,
          }));
        } else {
          userData['roles'] = [];
        }

        // Remove raw fields from response
        delete userData.avatar;
        delete userData.role_users;

        return userData;
      });

      return {
        success: true,
        data: usersWithAvatarUrls,
        pagination: {
          page: p,
          limit: l,
          total,
          totalPages: Math.ceil(total / l),
        },
        statistics: {
          total_users: totalUsers,
          total_banned_users: totalBannedUsers,
          total_admin_users: totalAdminUsers,
          total_garage_users: totalGarageUsers,
          total_driver_users: totalDriverUsers,
          total_approved_users: totalApprovedUsers,
        },
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

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // add avatar url to user
      if (user.avatar) {
        user['avatar_url'] = SojebStorage.url(
          appConfig().storageUrl.avatar + user.avatar,
        );
      }

      // ✅ ENHANCED: Get roles and permissions for admin users
      let userRoles = [];
      let userPermissions = [];
      let permissionSummary = {};

      if (user.type === 'ADMIN') {
        // Fetch user roles with role details
        const roleUsers = await this.prisma.roleUser.findMany({
          where: { user_id: id },
          include: {
            role: {
              include: {
                permission_roles: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        });

        // Extract role titles
        userRoles = roleUsers.map((ru) => ({
          id: ru.role.id,
          title: ru.role.title,
          name: ru.role.name,
          assigned_at: ru.created_at,
        }));

        // Extract all permissions from all roles
        const allPermissions = new Set();
        roleUsers.forEach((ru) => {
          ru.role.permission_roles.forEach((pr) => {
            allPermissions.add(
              JSON.stringify({
                id: pr.permission.id,
                title: pr.permission.title,
                action: pr.permission.action,
                subject: pr.permission.subject,
                conditions: pr.permission.conditions,
                fields: pr.permission.fields,
              }),
            );
          });
        });

        // Convert Set back to array of objects
        userPermissions = Array.from(allPermissions).map((permStr) =>
          JSON.parse(permStr as string),
        );

        // Create permission summary for easy frontend use
        permissionSummary = {
          can_manage_dashboard: userPermissions.some(
            (p) => p.subject === 'Dashboard',
          ),
          can_manage_garages: userPermissions.some(
            (p) => p.subject === 'Garage',
          ),
          can_manage_drivers: userPermissions.some(
            (p) => p.subject === 'Driver',
          ),
          can_manage_bookings: userPermissions.some(
            (p) => p.subject === 'Booking',
          ),
          can_manage_subscriptions: userPermissions.some(
            (p) => p.subject === 'Subscription',
          ),
          can_manage_payments: userPermissions.some(
            (p) => p.subject === 'Payment',
          ),
          can_manage_roles: userPermissions.some((p) => p.subject === 'Role'),
          can_manage_users: userPermissions.some((p) => p.subject === 'User'),
          can_view_analytics: userPermissions.some(
            (p) => p.subject === 'Analytics',
          ),
          can_generate_reports: userPermissions.some(
            (p) => p.subject === 'Reports',
          ),
          can_manage_system_tenant: userPermissions.some(
            (p) => p.subject === 'SystemTenant',
          ),
        };
      }

      // ✅ ENHANCED: Include roles and permissions in response
      const enhancedUserData = {
        ...user,
        ...(user.type === 'ADMIN' && {
          roles: userRoles,
          permissions: userPermissions,
          permission_summary: permissionSummary,
          role_count: userRoles.length,
          permission_count: userPermissions.length,
        }),
      };

      return {
        success: true,
        data: enhancedUserData,
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
      // ✅ SECURITY: Protect Super Admin user from critical changes
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
        select: { email: true, type: true },
      });

      if (
        existingUser &&
        existingUser.email === appConfig().defaultUser.system.email
      ) {
        if (updateUserDto.email && updateUserDto.email !== existingUser.email) {
          throw new BadRequestException(
            'Cannot change system administrator email',
          );
        }
        if (updateUserDto.type && updateUserDto.type !== 'ADMIN') {
          throw new BadRequestException(
            'Cannot change system administrator user type',
          );
        }
      }

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

  async remove(id: string, reason?: string) {
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

      // ✅ SECURITY: Protect Super Admin from being banned
      // Check by system email (primary protection)
      if (existingUser.email === appConfig().defaultUser.system.email) {
        return {
          success: false,
          message: 'Cannot ban system administrator',
        };
      }

      // ✅ SECURITY: Additional protection by checking Super Admin role
      const userRoles = await this.prisma.roleUser.findMany({
        where: { user_id: id },
        include: {
          role: {
            select: { name: true },
          },
        },
      });

      const isSuperAdmin = userRoles.some(
        (ur) => ur.role.name === 'super_admin',
      );
      if (isSuperAdmin) {
        return {
          success: false,
          message: 'Cannot ban Super Admin user',
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
        // console.log(
        //   `Admin user ${bannedUser.email} banned - skipping Stripe actions`,
        // );

        // Send admin-specific ban notification email
        const adminBanReason = reason?.trim() || 'Administrative action';
        await this.mailService.sendAdminBannedNotification({
          user: {
            name: bannedUser.name,
            email: bannedUser.email,
          },
          reason: adminBanReason,
        });
      } else {
        // GARAGE/DRIVER users: Handle Stripe actions and send user notifications
        await this.handleUserBanStripeActions(bannedUser);

        // Send user ban notification email
        const userBanReason = reason?.trim() || 'Administrative action';
        await this.mailService.sendUserBannedNotification({
          user: {
            name: bannedUser.name,
            email: bannedUser.email,
          },
          reason: userBanReason,
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
        // console.log(
        //   `Admin user ${unbannedUser.email} unbanned - skipping Stripe actions`,
        // );

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
            //console.error('Error checking subscription history:', error);
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
      //console.error('Error unbanning user:', error);
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
        // console.log(
        //   `User ${user.email} has no billing_id, skipping Stripe actions`,
        // );
        return;
      }

      //console.log(`Handling Stripe actions for banned user: ${user.email}`);

      // Get active subscriptions for the customer
      const activeSubscriptions = await StripePayment.getActiveSubscriptions(
        user.billing_id,
      );

      if (activeSubscriptions.length > 0) {
        //console.log(
        //  `Found ${activeSubscriptions.length} active subscriptions for user ${user.email}`,
        //);

        // Cancel subscriptions at period end (graceful cancellation)
        for (const subscription of activeSubscriptions) {
          try {
            await StripePayment.cancelSubscriptionAtPeriodEnd(subscription.id);
            //console.log(
            //  `Subscription ${subscription.id} will be cancelled at period end`,
            //);
          } catch (error) {
            //console.error(
            //  `Error cancelling subscription ${subscription.id}:`,
            //  error,
            //);
            // Continue with other subscriptions even if one fails
          }
        }
      } else {
        //console.log(`No active subscriptions found for user ${user.email}`);
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

      //console.log(
      //  `Successfully updated Stripe customer metadata for banned user: ${user.email}`,
      //);
    } catch (error) {
      //console.error(
      //  `Error handling Stripe actions for banned user ${user.email}:`,
      //  error,
      //);
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
        //console.log(
        //  `User ${user.email} has no billing_id, skipping Stripe actions`,
        //);
        return;
      }

      //console.log(`Handling Stripe actions for unbanned user: ${user.email}`);

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

      //console.log(
      //  `Successfully updated Stripe customer metadata for unbanned user: ${user.email}`,
      //);

      // Note: We don't automatically reactivate subscriptions
      // User must manually resubscribe if they want paid features
      // console.log(
      //   `User ${user.email} can manually resubscribe for paid features`,
      // );
    } catch (error) {
      //console.error(
      //  `Error handling Stripe actions for unbanned user ${user.email}:`,
      //  error,
      //);
      // Don't throw error to prevent unban operation from failing
      // Log the error and continue with the unban process
    }
  }

  async assignRoles(userId: string, roleIds: string[], currentUserId?: string) {
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

      // ✅ SECURITY: Prevent Super Admin role assignment via this endpoint
      const superAdminRole = validRoles.find(
        (role) => role.name === 'super_admin',
      );
      if (superAdminRole) {
        this.logger.warn(
          `Security violation prevented: Super Admin assignment attempt for user ${userId}`,
        );
        throw new BadRequestException(
          'Super Admin role cannot be assigned via this endpoint. Use system administrator tools.',
        );
      }

      // ✅ SECURITY: Only Super Admin can assign critical roles
      const criticalRoles = ['system_admin'];
      const hasCriticalRoles = validRoles.some((role) =>
        criticalRoles.includes(role.name),
      );

      if (hasCriticalRoles && currentUserId) {
        // Check if current user is Super Admin
        const currentUserRoles = await this.prisma.roleUser.findMany({
          where: { user_id: currentUserId },
          include: { role: { select: { name: true } } },
        });

        const isSuperAdmin = currentUserRoles.some(
          (ru) => ru.role.name === 'super_admin',
        );

        if (!isSuperAdmin) {
          this.logger.warn(
            `Security violation prevented: Non-super-admin attempted to assign critical roles to user ${userId}`,
          );
          throw new BadRequestException(
            'Insufficient permissions. Only Super Admin can assign critical roles.',
          );
        }
      } else if (hasCriticalRoles && !currentUserId) {
        // If no current user context, fail safely
        throw new BadRequestException(
          'Cannot verify permissions. Critical role assignment requires Super Admin privileges.',
        );
      }

      // ✅ SECURITY: Prevent self-assignment of critical roles
      if (hasCriticalRoles && currentUserId) {
        if (userId === currentUserId) {
          this.logger.warn(
            `Security violation prevented: Self-assignment of critical roles attempted by user ${currentUserId}`,
          );
          throw new BadRequestException(
            'Cannot assign critical roles to yourself. Use system administrator tools.',
          );
        }
      }

      // ✅ SECURITY: Protect Super Admin user's roles
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (targetUser?.email === appConfig().defaultUser.system.email) {
        // Ensure super_admin role is always included for the system user
        const hasSuperAdminInNewRoles = validRoles.some(
          (r) => r.name === 'super_admin',
        );
        if (!hasSuperAdminInNewRoles) {
          // Find the super_admin role to add it back
          const saRole = await this.prisma.role.findFirst({
            where: { name: 'super_admin' },
          });
          if (saRole) {
            validRoles.push(saRole);
          }
        }
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

      // ✅ SMART ROLE REPLACEMENT: Get existing roles with hierarchy info
      const existingRoles = await this.prisma.roleUser.findMany({
        where: { user_id: userId },
        include: { role: { select: { id: true, name: true } } },
      });

      // Apply intelligent role assignment logic
      const { rolesToAdd, rolesToRemove, strategy, reasoning } =
        this.calculateRoleChanges(existingRoles, validRoles);

      // Remove conflicting roles
      if (rolesToRemove.length > 0) {
        await this.prisma.roleUser.deleteMany({
          where: {
            user_id: userId,
            role_id: { in: rolesToRemove.map((role) => role.id) },
          },
        });
      }

      // Add new roles
      if (rolesToAdd.length > 0) {
        await this.prisma.roleUser.createMany({
          data: rolesToAdd.map((role) => ({
            user_id: userId,
            role_id: role.id,
          })),
        });
      }

      // ✅ AUDIT: Log intelligent role assignment
      if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
        this.logger.log(
          `Intelligent role assignment: User ${userId}, Strategy: ${strategy}, Added: ${rolesToAdd.map((r) => r.name).join(', ')}, Removed: ${rolesToRemove.map((r) => r.name).join(', ')}, Reasoning: ${reasoning}`,
        );
      }

      // ✅ NOTIFICATION: Send in-app notification for role assignment
      // TODO: Uncomment when in-app notifications are needed for role management
      // if (rolesToAdd.length > 0) {
      //   try {
      //     const roleNames = rolesToAdd.map((r) => r.name).join(', ');
      //     await this.notificationService.create({
      //       receiver_id: userId,
      //       type: NotificationType.ROLE_MANAGEMENT,
      //       text: `New role(s) assigned: ${roleNames}`,
      //       entity_id: userId,
      //     });
      //   } catch (error) {
      //     this.logger.error(
      //       `Failed to send role assignment notification: ${error.message}`,
      //     );
      //   }
      // }

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

      const addedRoles = rolesToAdd.length;
      const removedRoles = rolesToRemove.length;

      // ✅ INTELLIGENT FEEDBACK: Generate smart messages based on strategy
      let message = 'Roles assigned successfully';

      switch (strategy) {
        case 'intelligent_selection':
          message = `Smart assignment: Selected ${rolesToAdd.map((r) => r.name).join(', ')} (${reasoning})`;
          break;
        case 'upgrade':
          message = `Upgraded to ${rolesToAdd.map((r) => r.name).join(', ')} (${reasoning})`;
          break;
        case 'downgrade':
          message = `Downgraded to ${rolesToAdd.map((r) => r.name).join(', ')} (${reasoning})`;
          break;
        case 'same_level':
          message = `Added ${rolesToAdd.map((r) => r.name).join(', ')} at same level (${reasoning})`;
          break;
        default:
          if (addedRoles > 0 && removedRoles > 0) {
            message = `${addedRoles} role(s) added, ${removedRoles} role(s) removed`;
          } else if (addedRoles > 0) {
            message = `${addedRoles} role(s) assigned successfully`;
          } else if (removedRoles > 0) {
            message = `${removedRoles} role(s) removed successfully`;
          } else {
            message = 'No role changes needed';
          }
      }

      return {
        success: true,
        message,
        data: {
          ...updatedUser,
          roles: formattedRoles,
          role_users: undefined,
          roles_added: addedRoles,
          roles_removed: removedRoles,
          role_changes: {
            added: rolesToAdd.map((role) => ({ id: role.id, name: role.name })),
            removed: rolesToRemove.map((role) => ({
              id: role.id,
              name: role.name,
            })),
          },
          assignment_strategy: strategy,
          intelligent_reasoning: reasoning,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Get all roles assigned to a user
   * @param userId - The user ID
   * @returns Array of roles with id and title
   */
  async getUserRoles(userId: string) {
    try {
      // Validate user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Get user's roles
      const userRoles = await this.prisma.roleUser.findMany({
        where: { user_id: userId },
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
        orderBy: { role: { title: 'asc' } },
      });

      const formattedRoles = userRoles.map((ru) => ({
        id: ru.role.id,
        title: ru.role.title,
        name: ru.role.name,
        assigned_at: ru.created_at,
      }));

      return {
        success: true,
        data: formattedRoles,
        meta: {
          user_id: userId,
          user_name: user.name,
          user_email: user.email,
          total_roles: formattedRoles.length,
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
          select: { id: true, type: true, email: true },
        }),
        this.prisma.role.findUnique({
          where: { id: roleId },
          select: { id: true, name: true },
        }),
      ]);

      if (!user) throw new BadRequestException('User not found');
      if (!role) throw new BadRequestException('Role not found');

      // ✅ SECURITY: Protect Super Admin role from being removed
      if (role.name === 'super_admin') {
        throw new BadRequestException('Cannot remove Super Admin role');
      }

      // ✅ SECURITY: Additional protection for system administrator email
      if (
        user.email === appConfig().defaultUser.system.email &&
        role.name === 'super_admin'
      ) {
        throw new BadRequestException(
          'Cannot remove Super Admin role from system administrator',
        );
      }

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

      // ✅ NOTIFICATION: Send in-app notification for role removal
      // TODO: Uncomment when in-app notifications are needed for role management
      // try {
      //   await this.notificationService.create({
      //     receiver_id: userId,
      //     type: NotificationType.ROLE_MANAGEMENT,
      //     text: `Role removed: ${role.name}`,
      //     entity_id: userId,
      //   });
      // } catch (error) {
      //   this.logger.error(
      //     `Failed to send role removal notification: ${error.message}`,
      //   );
      // }

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

  // ✅ HELPER: Get current user ID from JWT context
  // Note: This is a placeholder implementation - actual implementation depends on your JWT context setup
  private async getCurrentUserId(): Promise<string> {
    // TODO: Implement actual JWT context extraction
    // For now, we'll use a placeholder that should be replaced with actual implementation
    throw new BadRequestException(
      'Current user context not available - please implement JWT context extraction',
    );
  }

  // ✅ HELPER: Get current user roles
  private async getCurrentUserRoles(): Promise<Array<{ name: string }>> {
    try {
      const currentUserId = await this.getCurrentUserId();
      const roleUsers = await this.prisma.roleUser.findMany({
        where: { user_id: currentUserId },
        include: { role: { select: { name: true } } },
      });
      return roleUsers.map((ru) => ({ name: ru.role.name }));
    } catch (error) {
      // If we can't get current user context, return empty array
      // This will cause authorization checks to fail safely
      return [];
    }
  }

  // ✅ INTELLIGENT ROLE ASSIGNMENT: Smart role selection based on hierarchy
  private calculateRoleChanges(
    existingRoles: Array<{ role: { id: string; name: string } }>,
    newRoles: Array<{ id: string; name: string }>,
  ): {
    rolesToAdd: Array<{ id: string; name: string }>;
    rolesToRemove: Array<{ id: string; name: string }>;
    strategy: string;
    reasoning: string;
  } {
    const existingRoleNames = existingRoles.map((er) => er.role.name);
    const newRoleNames = newRoles.map((nr) => nr.name);

    // ✅ INTELLIGENT SELECTION: Choose only the highest level role
    const assignedLevels = newRoleNames.map(
      (name) => this.roleHierarchy[name] || 0,
    );
    const targetLevel = Math.max(...assignedLevels);
    const selectedRoles = newRoles.filter(
      (role) => this.roleHierarchy[role.name] === targetLevel,
    );

    // ✅ DETECT MIXED LEVEL ASSIGNMENT
    const hasMixedLevels = new Set(assignedLevels).size > 1;
    const lowerRoles = newRoles.filter(
      (role) => this.roleHierarchy[role.name] < targetLevel,
    );

    const rolesToAdd: Array<{ id: string; name: string }> = [];
    const rolesToRemove: Array<{ id: string; name: string }> = [];
    let strategy: string;
    let reasoning: string;

    if (hasMixedLevels) {
      // ✅ MIXED LEVELS: Select only highest level role
      strategy = 'intelligent_selection';
      reasoning = `${selectedRoles[0].name} (Level ${targetLevel}) includes all permissions of ${lowerRoles.map((r) => r.name).join(', ')}`;

      // Remove all existing roles (clean slate)
      rolesToRemove.push(
        ...existingRoles.map((er) => ({ id: er.role.id, name: er.role.name })),
      );

      // Add only the highest level role
      rolesToAdd.push(...selectedRoles);
    } else {
      // ✅ SINGLE LEVEL: Standard replacement logic
      const existingMaxLevel = Math.max(
        ...existingRoleNames.map((name) => this.roleHierarchy[name] || 0),
      );

      if (targetLevel > existingMaxLevel) {
        strategy = 'upgrade';
        reasoning = `Upgrading to ${selectedRoles[0].name} (Level ${targetLevel})`;

        // Remove lower level roles, add new roles
        rolesToRemove.push(
          ...existingRoles
            .filter((er) => this.roleHierarchy[er.role.name] < targetLevel)
            .map((er) => ({ id: er.role.id, name: er.role.name })),
        );
        rolesToAdd.push(...selectedRoles);
      } else if (targetLevel < existingMaxLevel) {
        strategy = 'downgrade';
        reasoning = `Downgrading to ${selectedRoles[0].name} (Level ${targetLevel})`;

        // Remove higher level roles, add new roles
        rolesToRemove.push(
          ...existingRoles
            .filter((er) => this.roleHierarchy[er.role.name] > targetLevel)
            .map((er) => ({ id: er.role.id, name: er.role.name })),
        );
        rolesToAdd.push(...selectedRoles);
      } else {
        strategy = 'same_level';
        reasoning = `Adding roles at same level (Level ${targetLevel})`;

        // Add only new roles not already assigned
        rolesToAdd.push(
          ...selectedRoles.filter((nr) => !existingRoleNames.includes(nr.name)),
        );
      }
    }

    return { rolesToAdd, rolesToRemove, strategy, reasoning };
  }
}
