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
      message: 'Role created',
      data: role,
    };
  }

  async updateRole(id: string, dto: Partial<{ title: string; name: string }>) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

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

    // Prevent deleting protected system roles if needed
    if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(id)) {
      throw new BadRequestException('Protected role cannot be deleted');
    }

    // detach permissions first (FK constraints safety depending on schema)
    await this.prisma.permissionRole.deleteMany({ where: { role_id: id } });

    await this.prisma.role.delete({ where: { id } });

    return { success: true, message: 'Role deleted' };
  }

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { title: 'asc' },
      select: { id: true, title: true, action: true, subject: true },
    });

    return { success: true, data: { permissions } };
  }

  async setRolePermissions(
    id: string,
    dto: { mode: 'assign' | 'replace' | 'remove'; permission_ids: string[] },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    if (!Array.isArray(dto.permission_ids) || dto.permission_ids.length === 0) {
      throw new BadRequestException('permission_ids must be a non-empty array');
    }

    // Validate permissions exist
    const found = await this.prisma.permission.findMany({
      where: { id: { in: dto.permission_ids } },
      select: { id: true },
    });
    if (found.length !== dto.permission_ids.length) {
      throw new BadRequestException('One or more permission_ids are invalid');
    }

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
      throw new BadRequestException('Invalid mode');
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
      message: `Permissions ${dto.mode} successful`,
      data: {
        id: updated.id,
        title: updated.title,
        name: updated.name,
        permissions: updated.permission_roles.map((pr) => pr.permission),
      },
    };
  }
}
