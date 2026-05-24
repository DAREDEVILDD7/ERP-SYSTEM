export const ROLES = {
  ADMIN: 'Admin',
  SALES: 'Sales Executive',
  OPERATIONS: 'Operations Manager',
  WAREHOUSE: 'Warehouse Operator',
  DISPATCH: 'Dispatch Coordinator',
  FINANCE: 'Finance Officer',
  MAINTENANCE: 'Maintenance Engineer',
};

// What each role can see in the sidebar
export const ROLE_NAV = {
  [ROLES.ADMIN]: [
    'dashboard', 'requirements', 'quotations', 'equipment',
    'dispatch', 'maintenance', 'finance', 'customers',
    'chat', 'users', 'audit-logs',
  ],
  [ROLES.SALES]: [
    'dashboard', 'requirements', 'quotations', 'customers',
    'equipment', 'chat',
  ],
  [ROLES.OPERATIONS]: [
    'dashboard', 'requirements', 'quotations', 'equipment',
    'dispatch', 'maintenance', 'chat',
  ],
  [ROLES.WAREHOUSE]: [
    'dashboard', 'equipment', 'maintenance', 'chat',
  ],
  [ROLES.DISPATCH]: [
    'dashboard', 'dispatch', 'equipment', 'chat',
  ],
  [ROLES.FINANCE]: [
    'dashboard', 'quotations', 'finance', 'customers', 'chat',
  ],
  [ROLES.MAINTENANCE]: [
    'dashboard', 'maintenance', 'equipment', 'chat',
  ],
};

// Granular action permissions
export const PERMISSIONS = {
  // Requirements
  requirements_create:  [ROLES.ADMIN, ROLES.SALES],
  requirements_edit:    [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS],
  requirements_review:  [ROLES.ADMIN, ROLES.OPERATIONS],
  requirements_view:    [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS, ROLES.FINANCE, ROLES.DISPATCH, ROLES.MAINTENANCE],

  // Quotations
  quotations_create:    [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS],
  quotations_approve:   [ROLES.ADMIN, ROLES.FINANCE, ROLES.OPERATIONS],
  quotations_reject:    [ROLES.ADMIN, ROLES.FINANCE, ROLES.OPERATIONS],
  quotations_view:      [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS, ROLES.FINANCE],
  quotations_pdf:       [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS, ROLES.FINANCE],

  // Equipment
  equipment_create:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.WAREHOUSE],
  equipment_edit:       [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.WAREHOUSE, ROLES.DISPATCH],
  equipment_view:       Object.values(ROLES),

  // Dispatch
  dispatch_create:      [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH],
  dispatch_edit:        [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH],
  dispatch_view:        [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH, ROLES.SALES],

  // Maintenance
  maintenance_create:   [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE, ROLES.WAREHOUSE],
  maintenance_edit:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE],
  maintenance_view:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE, ROLES.WAREHOUSE],

  // Finance
  finance_view:         [ROLES.ADMIN, ROLES.FINANCE],
  invoice_create:       [ROLES.ADMIN, ROLES.FINANCE],

  // Users (admin only)
  users_manage:         [ROLES.ADMIN],
  audit_view:           [ROLES.ADMIN],
};

export function hasPermission(userRole, permission) {
  return PERMISSIONS[permission]?.includes(userRole) ?? false;
}

export function canAccess(userRole, navItem) {
  return ROLE_NAV[userRole]?.includes(navItem) ?? false;
}

// Dashboard redirect per role
export const ROLE_HOME = {
  [ROLES.ADMIN]:       '/dashboard',
  [ROLES.SALES]:       '/dashboard',
  [ROLES.OPERATIONS]:  '/dashboard',
  [ROLES.WAREHOUSE]:   '/dashboard',
  [ROLES.DISPATCH]:    '/dashboard',
  [ROLES.FINANCE]:     '/dashboard',
  [ROLES.MAINTENANCE]: '/dashboard',
};