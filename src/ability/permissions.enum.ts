export enum Permissions {
  // tenant
  tenant_management_read = 'tenant_management_read',
  tenant_management_create = 'tenant_management_create',
  tenant_management_update = 'tenant_management_update',
  tenant_management_show = 'tenant_management_show',
  tenant_management_delete = 'tenant_management_delete',
  // user
  user_management_read = 'user_management_read',
  user_management_create = 'user_management_create',
  user_management_update = 'user_management_update',
  user_management_show = 'user_management_show',
  user_management_delete = 'user_management_delete',
  // role
  role_management_read = 'role_management_read',
  role_management_create = 'role_management_create',
  role_management_update = 'role_management_update',
  role_management_show = 'role_management_show',
  role_management_delete = 'role_management_delete',
  // note
  note_read = 'note_read',
  note_create = 'note_create',
  note_update = 'note_update',
  note_show = 'note_show',
  note_delete = 'note_delete',

  // ========== ADMIN PERMISSIONS ==========
  // Dashboard
  dashboard_read = 'dashboard_read',

  // Garage Management
  garage_management_read = 'garage_management_read',
  garage_management_create = 'garage_management_create',
  garage_management_update = 'garage_management_update',
  garage_management_show = 'garage_management_show',
  garage_management_delete = 'garage_management_delete',
  garage_management_approve = 'garage_management_approve',

  // Driver Management
  driver_management_read = 'driver_management_read',
  driver_management_create = 'driver_management_create',
  driver_management_update = 'driver_management_update',
  driver_management_show = 'driver_management_show',
  driver_management_delete = 'driver_management_delete',

  // Booking Management
  booking_management_read = 'booking_management_read',
  booking_management_update = 'booking_management_update',
  booking_management_show = 'booking_management_show',
  booking_management_cancel = 'booking_management_cancel',
  booking_management_assign = 'booking_management_assign',

  // Subscription Management
  subscription_management_read = 'subscription_management_read',
  subscription_management_create = 'subscription_management_create',
  subscription_management_update = 'subscription_management_update',
  subscription_management_show = 'subscription_management_show',
  subscription_management_delete = 'subscription_management_delete',

  // Payment Management
  payment_management_read = 'payment_management_read',
  payment_management_create = 'payment_management_create',
  payment_management_refund = 'payment_management_refund',
  payment_management_show = 'payment_management_show',

  // Analytics & Reports
  analytics_read = 'analytics_read',
  reports_generate = 'reports_generate',
}
