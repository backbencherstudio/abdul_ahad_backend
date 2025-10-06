import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../../common/guard/role/role.enum';
import { Roles } from '../../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../../common/guard/role/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../../../ability/abilities.guard';
import { CheckAbilities } from '../../../ability/abilities.decorator';
import { Action } from '../../../ability/ability.factory';

@ApiBearerAuth()
@ApiTags('User')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@Controller('admin/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiResponse({ description: 'Create a user' })
  @Post()
  @CheckAbilities({ action: Action.Create, subject: 'User' })
  async create(@Body() createUserDto: CreateUserDto) {
    try {
      const user = await this.userService.create(createUserDto);
      return user;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiResponse({ description: 'Get all users' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'User' })
  async findAll(
    @Query() query: { q?: string; type?: string; approved?: string },
  ) {
    try {
      const q = query.q;
      const type = query.type;
      const approved = query.approved;

      const users = await this.userService.findAll({ q, type, approved });
      return users;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Get user details with roles and permissions' })
  @ApiResponse({
    status: 200,
    description: 'User details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'user_id' },
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', example: 'john@example.com' },
            type: { type: 'string', example: 'ADMIN' },
            phone_number: { type: 'string', example: '+1234567890' },
            approved_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            avatar: { type: 'string', nullable: true },
            avatar_url: { type: 'string', nullable: true },
            billing_id: { type: 'string', nullable: true },
            // Admin-specific fields
            roles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  name: { type: 'string' },
                  assigned_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            permissions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  action: { type: 'string' },
                  subject: { type: 'string' },
                },
              },
            },
            permission_summary: {
              type: 'object',
              properties: {
                can_manage_dashboard: { type: 'boolean' },
                can_manage_garages: { type: 'boolean' },
                can_manage_drivers: { type: 'boolean' },
                can_manage_bookings: { type: 'boolean' },
                can_manage_subscriptions: { type: 'boolean' },
                can_manage_payments: { type: 'boolean' },
                can_manage_roles: { type: 'boolean' },
                can_manage_users: { type: 'boolean' },
                can_view_analytics: { type: 'boolean' },
                can_generate_reports: { type: 'boolean' },
                can_manage_system_tenant: { type: 'boolean' },
              },
            },
            role_count: { type: 'number', example: 2 },
            permission_count: { type: 'number', example: 15 },
          },
        },
      },
    },
  })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'User' })
  async findOne(@Param('id') id: string) {
    try {
      const user = await this.userService.findOne(id);
      return user;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @Patch(':id')
  @CheckAbilities({ action: Action.Update, subject: 'User' })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    try {
      const user = await this.userService.update(id, updateUserDto);
      return user;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Ban user - Role-based actions' })
  @ApiResponse({
    status: 200,
    description: 'User banned successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'User banned successfully' },
        data: {
          type: 'object',
          properties: {
            user_id: { type: 'string', example: 'user_id' },
            email: { type: 'string', example: 'user@example.com' },
            name: { type: 'string', example: 'John Doe' },
            banned_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'User not found or already banned',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'User not found' },
      },
    },
  })
  @Post(':id/ban')
  @CheckAbilities({ action: Action.Update, subject: 'User' })
  async banUser(@Param('id') id: string) {
    try {
      const result = await this.userService.remove(id);

      if (!result.success) {
        return {
          statusCode: 400,
          success: false,
          message: result.message,
        };
      }

      return {
        statusCode: 200,
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      return {
        statusCode: 500,
        success: false,
        message: 'Internal server error: ' + error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Unban user - Role-based actions' })
  @ApiResponse({
    status: 200,
    description: 'User unbanned successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'User unbanned successfully' },
        data: {
          type: 'object',
          properties: {
            user_id: { type: 'string', example: 'user_id' },
            email: { type: 'string', example: 'user@example.com' },
            name: { type: 'string', example: 'John Doe' },
            unbanned_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'User not found or not banned',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'User not found' },
      },
    },
  })
  @Post(':id/unban')
  @CheckAbilities({ action: Action.Update, subject: 'User' })
  async unbanUser(@Param('id') id: string) {
    try {
      const result = await this.userService.unbanUser(id);

      if (!result.success) {
        return {
          statusCode: 400,
          success: false,
          message: result.message,
        };
      }

      return {
        statusCode: 200,
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      return {
        statusCode: 500,
        success: false,
        message: 'Internal server error: ' + error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Get user roles' })
  @ApiResponse({
    status: 200,
    description: 'User roles retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'role_id' },
              title: { type: 'string', example: 'Super Admin' },
              name: { type: 'string', example: 'super_admin' },
              assigned_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        meta: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            user_name: { type: 'string' },
            user_email: { type: 'string' },
            total_roles: { type: 'number' },
          },
        },
      },
    },
  })
  @Get(':id/roles')
  @CheckAbilities({ action: Action.Read, subject: 'User' })
  async getUserRoles(@Param('id') id: string) {
    try {
      const result = await this.userService.getUserRoles(id);
      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Assign roles to user (additive)' })
  @ApiResponse({
    status: 200,
    description: 'Roles assigned successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '2 role(s) assigned successfully' },
        data: {
          type: 'object',
          properties: {
            roles_added: { type: 'number', example: 2 },
            roles_skipped: { type: 'number', example: 0 },
            roles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  })
  @Post(':id/roles')
  @CheckAbilities({ action: Action.Update, subject: 'User' })
  async assignRoles(
    @Param('id') id: string,
    @Body() body: { role_ids: string[] },
  ) {
    try {
      const result = await this.userService.assignRoles(id, body.role_ids);
      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiResponse({ description: 'Remove role from user' })
  @Delete(':id/roles/:roleId')
  @CheckAbilities({ action: Action.Update, subject: 'User' })
  async removeRole(@Param('id') id: string, @Param('roleId') roleId: string) {
    try {
      const result = await this.userService.removeRole(id, roleId);
      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
