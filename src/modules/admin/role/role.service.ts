import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [roles, total] = await Promise.all([
      this.prisma.role.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          title: true,
          name: true,
          created_at: true,
          updated_at: true,
          permission_roles: {
            select: { permission_id: true },
          },
        },
      }),
      this.prisma.role.count(),
    ]);

    return {
      success: true,
      data: {
        roles: roles.map((r) => ({
          id: r.id,
          title: r.title,
          name: r.name,
          created_at: r.created_at,
          updated_at: r.updated_at,
          permission_count: r.permission_roles.length,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        name: true,
        created_at: true,
        updated_at: true,
        permission_roles: {
          select: {
            permission: {
              select: { id: true, title: true, action: true, subject: true },
            },
          },
        },
      },
    });

    if (!role) throw new NotFoundException('Role not found');

    return {
      success: true,
      data: {
        id: role.id,
        title: role.title,
        name: role.name,
        created_at: role.created_at,
        updated_at: role.updated_at,
        permissions: role.permission_roles.map((pr) => pr.permission),
      },
    };
  }

  async createRole(dto: { title: string; name: string }) {
    // Validate role name format
    if (!/^[a-z0-9_]+$/.test(dto.name)) {
      throw new BadRequestException(
        'Role name must be lowercase alphanumeric with underscores only',
      );
    }

    // Prevent creating system role names
    const systemRoleNames = [
      'super_admin',
      'system_admin',
      'financial_admin',
      'operations_admin',
      'support_admin',
    ];
    if (systemRoleNames.includes(dto.name)) {
      throw new BadRequestException('Cannot create role with system role name');
    }

    // Guard: name unique
    const exists = await this.prisma.role.findFirst({
      where: { name: dto.name },
      select: { id: true },
    });
    if (exists) throw new BadRequestException('Role name already exists');

    const role = await this.prisma.role.create({
      data: {
        title: dto.title,
        name: dto.name,
      },
      select: { id: true, title: true, name: true, created_at: true },
    });

    return {
      success: true,
      message: 'Role created successfully',
      data: role,
    };
  }

  async updateRole(id: string, dto: Partial<{ title: string; name: string }>) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    // Prevent modifying system roles (updated for new seeding system)
    const protectedRoles = ['super_admin', 'system_admin'];
    if (protectedRoles.includes(role.name)) {
      if (dto.name && dto.name !== role.name) {
        throw new BadRequestException(
          `Protected role '${role.title}' cannot be renamed`,
        );
      }
    }

    if (dto.name) {
      const dup = await this.prisma.role.findFirst({
        where: { name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (dup) throw new BadRequestException('Role name already exists');
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
      },
      select: { id: true, title: true, name: true, updated_at: true },
    });

    return {
      success: true,
      message: 'Role updated',
      data: updated,
    };
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    // Prevent deleting protected system roles by name
    const protectedRoles = ['super_admin', 'system_admin'];
    if (protectedRoles.includes(role.name)) {
      throw new BadRequestException(
        `Protected role '${role.title}' cannot be deleted`,
      );
    }

    // Check if role is being used by any users
    const roleUsage = await this.prisma.roleUser.findFirst({
      where: { role_id: id },
      select: { user_id: true },
    });

    if (roleUsage) {
      throw new BadRequestException(
        'Cannot delete role that is assigned to users. Please remove all role assignments first.',
      );
    }

    // detach permissions first (FK constraints safety)
    await this.prisma.permissionRole.deleteMany({ where: { role_id: id } });

    await this.prisma.role.delete({ where: { id } });

    return { success: true, message: 'Role deleted successfully' };
  }

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { title: 'asc' },
      select: { id: true, title: true, action: true, subject: true },
    });

    return { success: true, data: { permissions } };
  }

  async getRoleStatistics() {
    const [roleCount, userCount, permissionCount] = await Promise.all([
      this.prisma.role.count(),
      this.prisma.user.count(),
      this.prisma.permission.count(),
    ]);

    const roleUsage = await this.prisma.role.findMany({
      select: {
        id: true,
        title: true,
        name: true,
        _count: {
          select: {
            role_users: true,
            permission_roles: true,
          },
        },
      },
    });

    const systemRoles = ['super_admin', 'system_admin'];
    const systemRolesData = roleUsage.filter((r) =>
      systemRoles.includes(r.name),
    );
    const customRolesData = roleUsage.filter(
      (r) => !systemRoles.includes(r.name),
    );

    return {
      success: true,
      data: {
        summary: {
          total_roles: roleCount,
          system_roles: systemRolesData.length,
          custom_roles: customRolesData.length,
          total_users: userCount,
          total_permissions: permissionCount,
        },
        system_roles: systemRolesData.map((role) => ({
          id: role.id,
          title: role.title,
          name: role.name,
          user_count: role._count.role_users,
          permission_count: role._count.permission_roles,
        })),
        custom_roles: customRolesData.map((role) => ({
          id: role.id,
          title: role.title,
          name: role.name,
          user_count: role._count.role_users,
          permission_count: role._count.permission_roles,
        })),
      },
    };
  }

  async setRolePermissions(
    id: string,
    dto: { mode: 'assign' | 'replace' | 'remove'; permission_ids: string[] },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    // Prevent modifying system roles permissions
    const protectedRoles = ['super_admin', 'system_admin'];
    if (protectedRoles.includes(role.name)) {
      throw new BadRequestException(
        `Cannot modify permissions for protected role '${role.title}'`,
      );
    }

    if (!Array.isArray(dto.permission_ids) || dto.permission_ids.length === 0) {
      throw new BadRequestException('permission_ids must be a non-empty array');
    }

    // Validate permissions exist and get full permission details
    const found = await this.prisma.permission.findMany({
      where: { id: { in: dto.permission_ids } },
      select: { id: true, title: true, action: true, subject: true },
    });

    if (found.length !== dto.permission_ids.length) {
      const invalidIds = dto.permission_ids.filter(
        (id) => !found.some((p) => p.id === id),
      );
      throw new BadRequestException(
        `Invalid permission IDs: ${invalidIds.join(', ')}`,
      );
    }

    // Validate that permissions are not system-level permissions for non-super-admin roles
    if (role.name !== 'super_admin') {
      const systemPermissions = found.filter((p) =>
        p.title.startsWith('system_tenant_management_'),
      );
      if (systemPermissions.length > 0) {
        throw new BadRequestException(
          'System tenant management permissions can only be assigned to Super Admin role',
        );
      }
    }

    try {
      if (dto.mode === 'replace') {
        await this.prisma.permissionRole.deleteMany({ where: { role_id: id } });
        await this.prisma.permissionRole.createMany({
          data: dto.permission_ids.map((pid) => ({
            role_id: id,
            permission_id: pid,
          })),
          skipDuplicates: true,
        });
      } else if (dto.mode === 'assign') {
        await this.prisma.permissionRole.createMany({
          data: dto.permission_ids.map((pid) => ({
            role_id: id,
            permission_id: pid,
          })),
          skipDuplicates: true,
        });
      } else if (dto.mode === 'remove') {
        await this.prisma.permissionRole.deleteMany({
          where: { role_id: id, permission_id: { in: dto.permission_ids } },
        });
      } else {
        throw new BadRequestException(
          'Invalid mode. Must be assign, replace, or remove',
        );
      }

      // return role with permissions
      const updated = await this.prisma.role.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          name: true,
          permission_roles: {
            select: {
              permission: {
                select: { id: true, title: true, action: true, subject: true },
              },
            },
          },
        },
      });

      return {
        success: true,
        message: `Permissions ${dto.mode}d successfully`,
        data: {
          id: updated.id,
          title: updated.title,
          name: updated.name,
          permissions: updated.permission_roles.map((pr) => pr.permission),
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to ${dto.mode} permissions: ${error.message}`,
      );
    }
  }
}
