export const ROLES = {
  ADMIN:       'Admin',
  SALES:       'Sales Executive',
  OPERATIONS:  'Operations Manager',
  WAREHOUSE:   'Warehouse Operator',
  DISPATCH:    'Dispatch Coordinator',
  FINANCE:     'Finance Officer',
  MAINTENANCE: 'Maintenance Engineer',
  PROCUREMENT: 'Procurement Manager',
};

export const ROLE_NAV = {
  [ROLES.ADMIN]: [
    'dashboard','requirements','quotations','equipment',
    'dispatch','maintenance','finance','procurement',
    'customers','chat','users','audit-logs',
  ],
  [ROLES.SALES]: [
    'dashboard','requirements','quotations','customers',
    'equipment','chat',
  ],
  [ROLES.OPERATIONS]: [
    'dashboard','requirements','quotations','equipment',
    'dispatch','maintenance','chat',
  ],
  [ROLES.WAREHOUSE]: [
    'dashboard','equipment','maintenance','chat',
  ],
  [ROLES.DISPATCH]: [
    'dashboard','dispatch','equipment','chat',
  ],
  [ROLES.FINANCE]: [
    'dashboard','quotations','finance','procurement',
    'customers','chat',
  ],
  [ROLES.MAINTENANCE]: [
    'dashboard','maintenance','equipment','chat',
  ],
  [ROLES.PROCUREMENT]: [
    'dashboard','procurement','equipment','vendors',
    'finance','chat',
  ],
};

export const PERMISSIONS = {
  requirements_create:  [ROLES.ADMIN, ROLES.SALES],
  requirements_edit:    [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS],
  requirements_review:  [ROLES.ADMIN, ROLES.OPERATIONS],
  requirements_view:    Object.values(ROLES),

  quotations_create:    [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS],
  quotations_approve:   [ROLES.ADMIN, ROLES.FINANCE, ROLES.OPERATIONS],
  quotations_reject:    [ROLES.ADMIN, ROLES.FINANCE, ROLES.OPERATIONS],
  quotations_view:      [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS, ROLES.FINANCE],
  quotations_pdf:       [ROLES.ADMIN, ROLES.SALES, ROLES.OPERATIONS, ROLES.FINANCE],

  equipment_create:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.WAREHOUSE, ROLES.PROCUREMENT],
  equipment_edit:       [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.WAREHOUSE, ROLES.DISPATCH, ROLES.PROCUREMENT],
  equipment_view:       Object.values(ROLES),

  dispatch_create:      [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH],
  dispatch_edit:        [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH],
  dispatch_view:        [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.DISPATCH, ROLES.SALES],

  maintenance_create:   [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE, ROLES.WAREHOUSE],
  maintenance_edit:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE],
  maintenance_view:     [ROLES.ADMIN, ROLES.OPERATIONS, ROLES.MAINTENANCE, ROLES.WAREHOUSE],

  finance_view:         [ROLES.ADMIN, ROLES.FINANCE],
  invoice_create:       [ROLES.ADMIN, ROLES.FINANCE],

  procurement_create:   [ROLES.ADMIN, ROLES.PROCUREMENT, ROLES.OPERATIONS],
  procurement_approve:  [ROLES.ADMIN, ROLES.FINANCE],
  procurement_view:     [ROLES.ADMIN, ROLES.PROCUREMENT, ROLES.FINANCE, ROLES.OPERATIONS],
  po_create:            [ROLES.ADMIN, ROLES.PROCUREMENT, ROLES.FINANCE],
  vendor_manage:        [ROLES.ADMIN, ROLES.PROCUREMENT, ROLES.FINANCE],

  users_manage:         [ROLES.ADMIN],
  audit_view:           [ROLES.ADMIN],
  customers_write:      [ROLES.ADMIN, ROLES.SALES],
};

export function hasPermission(userRole, permission) {
  return PERMISSIONS[permission]?.includes(userRole) ?? false;
}

export function canAccess(userRole, navItem) {
  return ROLE_NAV[userRole]?.includes(navItem) ?? false;
}

export const ROLE_HOME = Object.fromEntries(
  Object.values(ROLES).map(r => [r, '/dashboard'])
);