// external imports
import { Command, CommandRunner } from 'nest-commander';
// internal imports
import appConfig from '../config/app.config';
import { StringHelper } from '../common/helper/string.helper';
import { UserRepository } from '../common/repository/user/user.repository';
import { PrismaService } from '../prisma/prisma.service';

@Command({ name: 'seed', description: 'prisma db seed' })
export class SeedCommand extends CommandRunner {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async run(passedParam: string[]): Promise<void> {
    await this.seed(passedParam);
  }

  async seed(param: string[]) {
    try {
      console.log(`Prisma Env: ${process.env.PRISMA_ENV}`);
      console.log('Seeding started...');

      // begin transaaction
      await this.prisma.$transaction(async ($tx) => {
        await this.roleSeed();
        await this.permissionSeed();
        await this.userSeed();
        await this.permissionRoleSeed();
      });

      console.log('Seeding done.');
    } catch (error) {
      throw error;
    }
  }

  //---- user section ----
  async userSeed() {
    // system admin, user id: 1
    const systemUser = await UserRepository.createSuAdminUser({
      username: appConfig().defaultUser.system.username,
      email: appConfig().defaultUser.system.email,
      password: appConfig().defaultUser.system.password,
    });

    // ✅ NEW: Auto-verify admin email
    await this.prisma.user.update({
      where: { id: systemUser.id },
      data: {
        email_verified_at: new Date(), // Auto-verify admin email
        approved_at: new Date(), // Auto-approve admin
      },
    });

    await this.prisma.roleUser.create({
      data: {
        user_id: systemUser.id,
        role_id: '1',
      },
    });
  }

  async permissionSeed() {
    let i = 0;
    const permissions = [];
    const permissionGroups = [
      // (system level )super admin level permission
      { title: 'system_tenant_management', subject: 'SystemTenant' },
      // end (system level )super admin level permission
      { title: 'user_management', subject: 'User' },
      { title: 'role_management', subject: 'Role' },
      // Project
      { title: 'Project', subject: 'Project' },
      // Task
      {
        title: 'Task',
        subject: 'Task',
        scope: ['read', 'create', 'update', 'show', 'delete', 'assign'],
      },
      // Comment
      { title: 'Comment', subject: 'Comment' },

      // NEW ADMIN PERMISSIONS
      { title: 'dashboard', subject: 'Dashboard' },

      { title: 'garage_management', subject: 'Garage' },

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
    ];

    for (const permissionGroup of permissionGroups) {
      if (permissionGroup['scope']) {
        for (const permission of permissionGroup['scope']) {
          permissions.push({
            id: String(++i),
            title: permissionGroup.title + '_' + permission,
            action: StringHelper.cfirst(permission),
            subject: permissionGroup.subject,
          });
        }
      } else {
        for (const permission of [
          'read',
          'create',
          'update',
          'show',
          'delete',
        ]) {
          permissions.push({
            id: String(++i),
            title: permissionGroup.title + '_' + permission,
            action: StringHelper.cfirst(permission),
            subject: permissionGroup.subject,
          });
        }
      }
    }

    await this.prisma.permission.createMany({
      data: permissions,
    });
  }

  async permissionRoleSeed() {
    const all_permissions = await this.prisma.permission.findMany();
    const su_admin_permissions = all_permissions.filter(
      (p) => p.title.substring(0, 25) == 'system_tenant_management_',
    );

    // Super Admin gets system tenant management
    const adminPermissionRoleArray = su_admin_permissions.map((p) => ({
      role_id: '1',
      permission_id: p.id,
    }));
    await this.prisma.permissionRole.createMany({
      data: adminPermissionRoleArray,
    });

    // Super Admin gets all admin permissions (dashboard/garage/driver/booking/subscription/payment/analytics/reports, plus user/role management)
    const admin_permissions = all_permissions.filter(
      (p) =>
        p.title.substring(0, 25) != 'system_tenant_management_' &&
        (p.title.startsWith('dashboard_') ||
          p.title.startsWith('garage_management_') ||
          p.title.startsWith('driver_management_') ||
          p.title.startsWith('booking_management_') ||
          p.title.startsWith('subscription_management_') ||
          p.title.startsWith('payment_management_') ||
          p.title.startsWith('analytics_') ||
          p.title.startsWith('reports_') ||
          p.title.startsWith('user_management_') ||
          p.title.startsWith('role_management_')),
    );
    await this.prisma.permissionRole.createMany({
      data: admin_permissions.map((p) => ({
        role_id: '1',
        permission_id: p.id,
      })),
    });

    // Financial Admin (role_id: 6)
    const financial_admin_permissions = all_permissions.filter(
      (p) =>
        p.title.startsWith('dashboard_') ||
        p.title.startsWith('subscription_management_') ||
        p.title.startsWith('payment_management_') ||
        p.title.startsWith('analytics_') ||
        p.title.startsWith('reports_'),
    );
    await this.prisma.permissionRole.createMany({
      data: financial_admin_permissions.map((p) => ({
        role_id: '6',
        permission_id: p.id,
      })),
    });

    // Operations Admin (role_id: 7)
    const operations_admin_permissions = all_permissions.filter(
      (p) =>
        p.title.startsWith('dashboard_') ||
        p.title.startsWith('garage_management_') ||
        p.title.startsWith('driver_management_') ||
        p.title.startsWith('booking_management_'),
    );
    await this.prisma.permissionRole.createMany({
      data: operations_admin_permissions.map((p) => ({
        role_id: '7',
        permission_id: p.id,
      })),
    });

    // Support Admin (role_id: 8) - read-only
    const support_admin_permissions = all_permissions.filter(
      (p) =>
        p.title == 'dashboard_read' ||
        (p.title.startsWith('garage_management_') &&
          p.title.endsWith('_read')) ||
        (p.title.startsWith('driver_management_') &&
          p.title.endsWith('_read')) ||
        (p.title.startsWith('booking_management_') &&
          p.title.endsWith('_read')),
    );
    await this.prisma.permissionRole.createMany({
      data: support_admin_permissions.map((p) => ({
        role_id: '8',
        permission_id: p.id,
      })),
    });

    // (keep existing mappings for project_manager/member/viewer as they are)
  }

  async roleSeed() {
    await this.prisma.role.createMany({
      data: [
        // system role
        {
          id: '1',
          title: 'Super Admin', // system admin, do not assign to a tenant/user
          name: 'su_admin',
        },
        // organization role
        {
          id: '2',
          title: 'Admin',
          name: 'admin',
        },
        {
          id: '3',
          title: 'Project Manager',
          name: 'project_manager',
        },
        {
          id: '4',
          title: 'Member',
          name: 'member',
        },
        {
          id: '5',
          title: 'Viewer',
          name: 'viewer',
        },
        // NEW
        { id: '6', title: 'Financial Admin', name: 'financial_admin' },
        { id: '7', title: 'Operations Admin', name: 'operations_admin' },
        { id: '8', title: 'Support Admin', name: 'support_admin' },
      ],
    });
  }
}
