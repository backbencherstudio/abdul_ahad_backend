import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  UseGuards,
  Query,
  Body,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { AbilitiesGuard } from 'src/ability/abilities.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { CheckAbilities } from 'src/ability/abilities.decorator';
import { Action } from 'src/ability/ability.factory';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@ApiTags('Admin Role Management')
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @ApiOperation({ summary: 'List roles' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Role' })
  async listRoles(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const p = parseInt(page, 10);
    const l = parseInt(limit, 10);
    if (isNaN(p) || isNaN(l) || p < 1 || l < 1) {
      throw new BadRequestException('Invalid page or limit parameters');
    }
    return this.roleService.listRoles(p, l);
  }
  @Get('permissions')
  @CheckAbilities({ action: Action.Read, subject: 'Role' })
  async listPermissions() {
    return this.roleService.listPermissions();
  }

  @ApiOperation({ summary: 'Get role statistics and usage information' })
  @ApiResponse({
    status: 200,
    description: 'Role statistics retrieved successfully',
  })
  @Get('statistics')
  @CheckAbilities({ action: Action.Read, subject: 'Role' })
  async getRoleStatistics() {
    return this.roleService.getRoleStatistics();
  }

  @ApiOperation({ summary: 'Get role by id (with permissions)' })
  @ApiResponse({ status: 200, description: 'Role retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Role' })
  async getRole(@Param('id') id: string) {
    return this.roleService.getRole(id);
  }

  @ApiOperation({ summary: 'Create role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid role data or name already exists',
  })
  @Post()
  @CheckAbilities({ action: Action.Create, subject: 'Role' })
  async createRole(@Body() dto: CreateRoleDto) {
    return this.roleService.createRole(dto);
  }

  @ApiOperation({ summary: 'Update role' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({
    status: 400,
    description: 'Invalid role data or name already exists',
  })
  @Put(':id')
  @CheckAbilities({ action: Action.Update, subject: 'Role' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roleService.updateRole(id, dto);
  }

  @ApiOperation({ summary: 'Delete role' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 400, description: 'Protected role cannot be deleted' })
  @Delete(':id')
  @CheckAbilities({ action: Action.Delete, subject: 'Role' })
  async deleteRole(@Param('id') id: string) {
    return this.roleService.deleteRole(id);
  }

  @ApiOperation({ summary: 'List all permissions (for UI pickers)' })
  @ApiResponse({
    status: 200,
    description: 'Permissions retrieved successfully',
  })
  @ApiOperation({ summary: 'Assign/replace/remove permissions on a role' })
  @ApiResponse({
    status: 200,
    description: 'Role permissions updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 400, description: 'Invalid permission data' })
  @Post(':id/permissions')
  @CheckAbilities({ action: Action.Update, subject: 'Role' })
  async setRolePermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roleService.setRolePermissions(id, dto);
  }
}
