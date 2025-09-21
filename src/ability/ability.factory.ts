import { AbilityBuilder, ExtractSubjectType, PureAbility } from '@casl/ability';
import { createPrismaAbility, Subjects, PrismaQuery } from '@casl/prisma';
import { Injectable } from '@nestjs/common';
import { User, Role, Vehicle, Order, PaymentTransaction } from '@prisma/client';

export enum Action {
  Manage = 'manage', // wildcard for any action
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Show = 'show',
  Delete = 'delete',
  Assign = 'assign',
  Approve = 'approve',
  Cancel = 'cancel',
  Refund = 'refund',
}

export type AppSubjects = Subjects<{
  Tenant: User;
  User: User;
  Role: Role;
  Example: User;
  // Admin subjects - using actual model types
  Dashboard: User; // Using User as base type for dashboard
  Garage: User;
  Driver: User;
  Booking: Order;
  Subscription: User; // Using User as base type for subscription
  Payment: PaymentTransaction;
  Analytics: User; // Using User as base type for analytics
  Reports: User; // Using User as base type for reports
}>;

type AppAbility = PureAbility<[string, AppSubjects], PrismaQuery>;

function doCan(can, permissionRoles) {
  const action = permissionRoles.permission.action;
  const subject = permissionRoles.permission.subject;

  can(Action[action], subject);
}

@Injectable()
export class AbilityFactory {
  defineAbility(user) {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createPrismaAbility,
    );

    if (user) {
      for (const permissionRoles of user.role_users) {
        for (const permissionRole of permissionRoles.role.permission_roles) {
          doCan(can, permissionRole);
        }
      }
    }

    return build({
      detectSubjectType: (item) =>
        item.constructor as ExtractSubjectType<AppAbility>,
    });
  }
}
