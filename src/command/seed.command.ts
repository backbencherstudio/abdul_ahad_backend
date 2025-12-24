// external imports
import { Command, CommandRunner } from 'nest-commander';
// internal imports
import appConfig from '../config/app.config';
import { StringHelper } from '../common/helper/string.helper';
import { UserRepository } from '../common/repository/user/user.repository';
import { PrismaService } from '../prisma/prisma.service';

interface RoleData {
  title: string;
  name: string;
}

interface PermissionGroupData {
  title: string;
  subject: string;
  scope?: string[];
}

interface RolePermissionMap {
  [roleName: string]: string[];
}

@Command({ name: 'seed', description: 'prisma db seed' })
export class SeedCommand extends CommandRunner {
  private roleMap: Map<string, any> = new Map();
  private permissionMap: Map<string, any> = new Map();

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async run(passedParam: string[]): Promise<void> {
    await this.seed(passedParam);
  }

  async seed(param: string[]): Promise<void> {
    try {
      console.log(`Prisma Env: ${process.env.PRISMA_ENV}`);
      console.log('🌱 Seeding started...');

      // Begin transaction for data consistency
      await this.prisma.$transaction(async ($tx) => {
        console.log('📋 Step 1: Seeding roles...');
        await this.roleSeed();

        console.log('🔐 Step 2: Seeding permissions...');
        await this.permissionSeed();

        console.log('👤 Step 3: Seeding system user...');
        await this.userSeed();

        console.log('🔗 Step 4: Assigning permissions to roles...');
        await this.permissionRoleSeed();

        console.log('✅ All seeding steps completed successfully!');
      });

      console.log('🎉 Seeding completed successfully!');
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      throw error;
    }
  }

  //---- user section ----
  async userSeed(): Promise<void> {
    console.log(`   Creating/updating system admin user...`);

    try {
      const email = appConfig().defaultUser.system.email;

      // Check if system admin user already exists
      let systemUser = await this.prisma.user.findFirst({
        where: { email: email },
      });

      if (systemUser) {
        console.log(`   🔄 System admin user already exists: ${email}`);

        // Update existing user to ensure it's verified and approved
        systemUser = await this.prisma.user.update({
          where: { id: systemUser.id },
          data: {
            email_verified_at: new Date(),
            approved_at: new Date(),
            updated_at: new Date(),
          },
        });
      } else {
        // Create new system admin user
        systemUser = await UserRepository.createSuAdminUser({
          username: appConfig().defaultUser.system.username,
          email: appConfig().defaultUser.system.email,
          password: appConfig().defaultUser.system.password,
        });

        // Auto-verify and approve admin user
        systemUser = await this.prisma.user.update({
          where: { id: systemUser.id },
          data: {
            email_verified_at: new Date(),
            approved_at: new Date(),
          },
        });

        console.log(`   ✅ System admin user created: ${systemUser.email}`);
      }

      // Assign super admin role using dynamic reference
      const superAdminRole = this.roleMap.get('super_admin');
      if (!superAdminRole) {
        throw new Error('Super admin role not found in role map');
      }

      // Check if role assignment already exists
      const existingRoleAssignment = await this.prisma.roleUser.findFirst({
        where: {
          role_id: superAdminRole.id,
          user_id: systemUser.id,
        },
      });

      if (!existingRoleAssignment) {
        await this.prisma.roleUser.create({
          data: {
            user_id: systemUser.id,
            role_id: superAdminRole.id,
          },
        });
        console.log(`   ✅ Super admin role assigned to user`);
      } else {
        console.log(`   🔄 Super admin role already assigned to user`);
      }
    } catch (error) {
      console.error(`   ❌ Failed to create/update system admin user:`, error);
      throw error;
    }
  }

  async permissionSeed(): Promise<void> {
    // Define permission groups for MOT system (removed unnecessary groups)
    const permissionGroups: PermissionGroupData[] = [
      // System level permissions
      { title: 'tenant_management', subject: 'Tenant' },

      // Core management permissions
      { title: 'user_management', subject: 'User' },
      { title: 'role_management', subject: 'Role' },

      // MOT-specific permissions
      { title: 'dashboard', subject: 'Dashboard' },
      {
        title: 'garage_management',
        subject: 'Garage',
        scope: ['read', 'create', 'update', 'show', 'delete', 'approve'],
      },
      { title: 'driver_management', subject: 'Driver' },
      {
        title: 'booking_management',
        subject: 'Booking',
        scope: ['read', 'update', 'show', 'cancel', 'assign'],
      },
      { title: 'subscription_management', subject: 'Subscription' },
      {
        title: 'payment_management',
        subject: 'Payment',
        scope: ['read', 'create', 'refund', 'show'],
      },
      { title: 'analytics', subject: 'Analytics' },
      { title: 'reports', subject: 'Reports', scope: ['generate'] },

      // Additional system modules
      { title: 'faq_management', subject: 'User' }, // Using User as base for generic modules
      { title: 'contact_management', subject: 'User' },
      { title: 'website_info_management', subject: 'User' },
      { title: 'notification_management', subject: 'User' },
    ];

    console.log(
      `   Creating permissions for ${permissionGroups.length} groups...`,
    );

    // Generate permissions dynamically
    for (const permissionGroup of permissionGroups) {
      const scope = permissionGroup.scope || [
        'read',
        'create',
        'update',
        'show',
        'delete',
      ];

      for (const action of scope) {
        const permissionTitle = `${permissionGroup.title}_${action}`;

        try {
          let permission = await this.prisma.permission.findFirst({
            where: { title: permissionTitle },
          });

          if (permission) {
            // Update existing permission
            permission = await this.prisma.permission.update({
              where: { id: permission.id },
              data: {
                action: StringHelper.cfirst(action),
                subject: permissionGroup.subject,
                updated_at: new Date(),
              },
            });
            console.log(`   🔄 Permission updated: ${permissionTitle}`);
          } else {
            // Create new permission
            permission = await this.prisma.permission.create({
              data: {
                title: permissionTitle,
                action: StringHelper.cfirst(action),
                subject: permissionGroup.subject,
              },
            });
            console.log(`   ✅ Permission created: ${permissionTitle}`);
          }

          this.permissionMap.set(permissionTitle, permission);
        } catch (error) {
          console.error(
            `   ❌ Failed to create/update permission ${permissionTitle}:`,
            error,
          );
          throw error;
        }
      }
    }

    console.log(
      `   📊 Total permissions processed: ${this.permissionMap.size}`,
    );
  }

  async permissionRoleSeed(): Promise<void> {
    console.log(`   Assigning permissions to roles...`);

    // Configuration-driven permission assignment
    const rolePermissionMap: RolePermissionMap = {
      super_admin: [
        'tenant_management',
        'user_management',
        'role_management',
        'dashboard',
        'garage_management',
        'driver_management',
        'booking_management',
        'subscription_management',
        'payment_management',
        'analytics',
        'reports',
        'faq_management',
        'contact_management',
        'website_info_management',
        'notification_management',
      ],
      system_admin: [
        'user_management',
        'role_management',
        'dashboard',
        'garage_management',
        'driver_management',
        'booking_management',
        'subscription_management',
        'payment_management',
        'analytics',
        'reports',
      ],
      financial_admin: [
        'dashboard',
        'subscription_management',
        'payment_management',
        'analytics',
        'reports',
      ],
      operations_admin: [
        'dashboard',
        'garage_management',
        'driver_management',
        'booking_management',
      ],
      support_admin: [
        'dashboard_read',
        'garage_management_read',
        'driver_management_read',
        'booking_management_read',
      ],
    };

    let totalAssignments = 0;

    // Process each role's permissions
    for (const [roleName, permissionGroups] of Object.entries(
      rolePermissionMap,
    )) {
      const role = this.roleMap.get(roleName);
      if (!role) {
        console.error(`   ❌ Role not found: ${roleName}`);
        continue;
      }

      console.log(`   📋 Assigning permissions to ${role.title}...`);
      let roleAssignments = 0;

      for (const permissionGroup of permissionGroups) {
        // Find permissions that match this group
        const matchingPermissions = Array.from(
          this.permissionMap.values(),
        ).filter((permission) => {
          if (permissionGroup.endsWith('_read')) {
            return permission.title === permissionGroup;
          }
          return permission.title.startsWith(permissionGroup + '_');
        });

        for (const permission of matchingPermissions) {
          try {
            await this.prisma.permissionRole.upsert({
              where: {
                permission_id_role_id: {
                  permission_id: permission.id,
                  role_id: role.id,
                },
              },
              update: {},
              create: {
                permission_id: permission.id,
                role_id: role.id,
              },
            });

            roleAssignments++;
            totalAssignments++;
          } catch (error) {
            console.error(
              `   ❌ Failed to assign permission ${permission.title} to ${roleName}:`,
              error,
            );
            throw error;
          }
        }
      }

      console.log(
        `   ✅ ${role.title}: ${roleAssignments} permissions assigned`,
      );
    }

    console.log(`   📊 Total permission assignments: ${totalAssignments}`);
  }

  async roleSeed(): Promise<void> {
    // Define roles for MOT system (removed unnecessary roles)
    const roles: RoleData[] = [
      { title: 'Super Admin', name: 'super_admin' },
      { title: 'System Admin', name: 'system_admin' },
      { title: 'Financial Admin', name: 'financial_admin' },
      { title: 'Operations Admin', name: 'operations_admin' },
      { title: 'Support Admin', name: 'support_admin' },
    ];

    console.log(`   Creating ${roles.length} roles...`);

    // Use findFirst + create/update to make seeding idempotent
    for (const roleData of roles) {
      try {
        let role = await this.prisma.role.findFirst({
          where: { name: roleData.name },
        });

        if (role) {
          // Update existing role
          role = await this.prisma.role.update({
            where: { id: role.id },
            data: {
              title: roleData.title,
              updated_at: new Date(),
            },
          });
          console.log(
            `   🔄 Role updated: ${roleData.title} (${roleData.name})`,
          );
        } else {
          // Create new role
          role = await this.prisma.role.create({
            data: roleData,
          });
          console.log(
            `   ✅ Role created: ${roleData.title} (${roleData.name})`,
          );
        }

        this.roleMap.set(roleData.name, role);
      } catch (error) {
        console.error(
          `   ❌ Failed to create/update role ${roleData.name}:`,
          error,
        );
        throw error;
      }
    }

    console.log(`   📊 Total roles processed: ${this.roleMap.size}`);
  }
}
