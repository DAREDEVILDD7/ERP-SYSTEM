# Authorization & Permissions

Super Admin RBAC. This document is the reference; see
`docs/architecture.md` for the auth session model.

Files:
- `frontend/add_super_admin_rbac.sql`
- `frontend/add_user_module_overrides.sql`
- `frontend/fix_password_reset_authorization.sql`
- `frontend/password_reset_requests.sql`
- `frontend/src/context/PermissionsContext.jsx`
- `frontend/src/lib/rolePermissions.js`
- `frontend/src/api/admin.js`
- `frontend/src/pages/admin/UserManagement.jsx`
- `frontend/src/pages/admin/PermissionsManagement.jsx`

## Evaluation order

`PermissionsContext.canView` and `canEdit` resolve access in this
exact sequence:

1. **Super Admin** → unconditional `true`.
2. **User-level module override** for `(current user, module)` — if a
   row exists in `user_module_overrides`, use its `can_view` /
   `can_edit` verbatim (per-user override replaces role for this user
   only).
3. **Role permission** for `(current user's role, module)` —
   `role_permissions.can_view` / `can_edit`.
4. **Default deny** (`false`).

A separate `isModuleEnabled(module)` gate is ANDed with `canEdit`
(and inside `canAccessModule`) — a Super Admin disabling a module
system-wide overrides even a user with an active grant.

**Do not reorder or short-circuit.** Skipping the override lookup and
going straight to role would silently break the requirement that user
overrides beat role permissions.

## Two layers, deliberately not merged

- `lib/rolePermissions.js` — the original static hard-coded role
  matrix (`ROLES`, `ROLE_NAV`, `PERMISSIONS`, `hasPermission`,
  `canAccess`). Still runs unchanged everywhere it used to.
- `PermissionsContext` — the DB-backed layer
  (`role_permissions` / `modules` / `user_permission_overrides` /
  `user_module_overrides` tables) that a Super Admin can edit live.

Where a page had a fine-grained static check
(`canWrite = hasPermission(role, 'x_create')`), the DB layer's
`canEdit('module')` is **ANDed on top** —
`hasPermission(...) && canEdit('module')` — never replaces it. So a
Super Admin can further *restrict* a role/module (or a specific user)
live, but a bad or missing DB row can never *grant* more than the
static matrix already allowed.

Only `ProtectedRoute` / `Sidebar` / `MobileNav` — which had no
fine-grained check to preserve, just the coarse `ROLE_NAV` list — are
a full replacement (`canAccessModule` / `canView` instead of
`canAccess`).

Do not "simplify" by deleting the static matrix. That removes the
fine-grained boundary the DB layer was designed to sit on top of, not
replace.

## Super Admin

`ROLES.SUPER_ADMIN` sits above `Admin` with unconditional access
everywhere (`fn_is_super_admin` on the DB side;
`role === ROLES.SUPER_ADMIN` bypass in `hasPermission` / `canAccess` /
`PermissionsContext`). It deliberately has **no rows** in
`role_permissions` — a missing or malformed row can never lock a
Super Admin out of their own system.

### Immunity — enforced in four places

Every one is load-bearing:

1. `PermissionsManagement.jsx`'s `EDITABLE_ROLES` filter removes
   `Super Admin` from the role×module grid.
2. `admin_set_role_permission` RPC raises when
   `p_role = 'Super Admin'`.
3. `admin_set_user_module_override` RPC raises when the target's role
   is `Super Admin` or when actor = target.
4. `PermissionsContext.canAccessModule` short-circuits to `true` for
   Super Admin **before** consulting `isModuleEnabled`, so
   `admin_set_module_enabled(module, false)` can never hide the
   module (including the Roles & Permissions page and the module
   toggle itself) from the Super Admin who turned it off.

`canView` and `canEdit` already have the Super Admin early-return as
the first line of their bodies, so together with (4), every gate that
ever asks "can this user access X" answers `true` for a Super Admin
regardless of any row in `role_permissions`, `user_module_overrides`,
or `modules`. `ProtectedRoute`'s maintenance-mode check separately
gates on `!isSuperAdmin` for the same reason.

Do not "simplify" `canAccessModule` back to
`canView && isModuleEnabled` — that reopens the module-disable
self-lockout.

## User module overrides

Semantics:

- Row absent = "inherit from role" (runtime falls through to step 3).
- Row present with `can_view=true` = user gains access even if role
  denies.
- Row present with `can_view=false` = user loses access even if role
  allows.
- The set RPC coerces `can_edit=false` when `can_view=false` at the
  storage layer, so a stale "edit but not view" row can never exist.
- Clearing an override is a DELETE (via
  `admin_clear_user_module_override`), never a false-write — absence
  is the unambiguous "inherit" state.

## Privileged mutations — server-only

Every privileged mutation goes through a `SECURITY DEFINER` RPC:
`admin_set_user_role`, `admin_set_user_active`,
`admin_reset_user_password`, `admin_create_user`,
`admin_set_role_permission`, `admin_set_module_enabled`,
`admin_grant_user_permission`, `admin_set_user_module_override`,
`admin_clear_user_module_override`. See `api/admin.js`.

Each re-verifies the acting user's role fresh from `users` on every
call. **Never trust a client-passed role/permission for a write.**

All four permission tables grant `SELECT` only to `anon` /
`authenticated`. There is no direct write grant; the RPCs are the
only write path.

`admin_reset_user_password` and `admin_create_user` both internally
call the pre-existing `set_user_password` RPC rather than
reimplementing password hashing.

`admin_set_user_module_override` refuses to write against a Super
Admin target or the actor's own account — those writes would be
silent no-ops under the runtime bypass; failing loud makes the intent
explicit.

## Privilege ceiling

`fn_can_manage_target` in the SQL: a regular Admin (even one granted
`users` edit access) can only act on a target whose *current* role is
below Admin — only Super Admin can touch another Admin or a Super
Admin. This is what stops privilege escalation.

Do not add a path that lets a lower role write another user's role or
`is_active` directly. The plain `updateUser()` table write in
`api/users.js` must never be used for `role` or `is_active` — see
`UserManagement.jsx`'s `handleSave` for the pattern of routing those
through the RPCs.

## Password-reset grant

"Reset Password" is individually grantable, off for every Admin by
default. `fn_can_reset_passwords`: Super Admin always, or a specific
Admin via a `user_permission_overrides` row with
`permission_key = 'password_reset'`.

Gates both the `PasswordResetRequests` page's own render and its
sidebar / mobile-nav visibility (a special case in `Sidebar.jsx` /
`MobileNav.jsx` alongside the normal per-module check, since this
permission isn't purely role-based).

### Server-side authorization

The 5 password-reset RPCs (`admin_list_password_reset_requests`,
`admin_get_password_reset_request`,
`admin_start_password_reset_request`,
`admin_complete_password_reset_request`,
`admin_reject_password_reset_request`) all gate on
`_is_active_admin(p_user_id)`.

Since `fix_password_reset_authorization.sql`, `_is_active_admin`
delegates to `fn_can_reset_passwords` — Super Admin unconditional,
plus Admin-with-`password_reset`-grant. The function name predates the
Super Admin work; its literal reading ("is active Admin") is narrower
than its current semantics ("is authorized to process password reset
requests"). **Do not read the name as authoritative; read the body.**

If you add a new privileged operation that needs a plain "is this
user an active Admin" check unrelated to password-reset grants, do
not reuse this helper — inline the role/is_active check or add a new
one. Reusing it would silently restrict the new operation to
grant-holders only.

`admin_grant_user_permission` is the sole write path into
`user_permission_overrides`. It refuses Super Admin targets and
actor-on-self at the storage layer, so "Super Admin permissions are
unconditional and cannot be granted or revoked" is enforced at the
RPC boundary, not just at evaluation time.

## Real-time behaviour

### Credential revocation, no logout required

`PermissionsContext` subscribes (via `useRealtimeRefresh`) to
`role_permissions` / `modules` / `user_permission_overrides` /
`users`. It also watches the *current* user's own `users.is_active`;
if it flips to `false`, it calls `AuthContext.logout()` immediately.
That is how revoking an Admin's credentials takes effect without
waiting for their next request to fail.

### Live role refresh

The same watch on the signed-in user's own `users` row also compares
`role`. If a Super Admin changes THIS user's own role while they're
signed in, `PermissionsContext` calls
`AuthContext.updateProfileRole()`, which patches `profile.role` (and
re-persists `sessionStorage`). `DashboardRouter` reads `role` from
`useAuth()`, so it re-renders with the correct dashboard immediately.

This is the only path that mutates `profile` outside `login()` /
`logout()`. Do not add another one without the same "only when the DB
value actually changed" guard (`lastKnownRole` ref) — every realtime
tick would otherwise force needless re-renders.

## Maintenance mode

A single row in the existing `modules` table (`module_key =
'system_maintenance'`, deliberately distinct from the `'maintenance'`
equipment-maintenance business module — do not conflate them),
toggled from the Super Admin dashboard's "Maintenance Mode" card via
`admin_set_module_enabled`. No new table or RPC.

`ProtectedRoute` blocks every route for every non-Super-Admin while
it's on, via `PermissionsContext.isMaintenanceModeOn`. That value is
**not** `isModuleEnabled()` (which is `?? true` — correct for
ordinary nav modules where the safe failure mode is "don't hide
things"). `isMaintenanceModeOn` is a strict
`moduleMap?.get('system_maintenance') === true` instead — the safe
failure mode here is the opposite.

**This is a real bug that shipped once already.** Before the row
existed in a given database, the generic `?? true` fallback read
"row not found" as "maintenance is on" and locked out every
non-Super-Admin user for a reason nobody chose. Never let this check
go back through `isModuleEnabled()` or any other helper with an
enabled-by-default fallback.

## Provider memoisation

`PermissionsContext` provider value is `useMemo`-wrapped. Consumers
(`Sidebar` / `MobileNav` / `ProtectedRoute` and every page that reads
permissions) only re-render when the semantic value changes. The
functions inside are already `useCallback`-wrapped and booleans are
primitives, so `===` dependency checks are exact.

Do not replace the memo with an inline object literal — that
reintroduces a full-tree consumer re-render on any internal state
flip inside `PermissionsProvider` (rolePerms / moduleMap / overrides
/ moduleOverrides / source), which is O(consumers) and hits every
screen.

## Fail-safe

If the permission tables can't be fetched (network blip, migration
not yet run), `PermissionsContext` falls back to the original static
`rolePermissions.js` matrix — rather than locking everyone out or
granting blanket access.

## Data model

Migration entry points: `add_super_admin_rbac.sql` (safe to re-run),
`add_user_module_overrides.sql`, `fix_password_reset_authorization.sql`,
`password_reset_requests.sql`.

- `role_permissions(role, module_key, can_view, can_edit)` — seeded to
  reproduce the pre-existing `ROLE_NAV` / `PERMISSIONS` matrix. No
  rows for Super Admin.
- `modules(module_key, label, is_enabled)` — seeded with every
  existing nav key, all enabled, plus `system_maintenance` seeded
  `is_enabled = false`.
- `user_permission_overrides(user_id, permission_key, granted)` —
  used today for `permission_key = 'password_reset'`.
- `user_module_overrides(user_id, module_key, can_view, can_edit)` —
  per-user grants/denies for a module.

RLS is off; `SELECT`-only grants to `anon` / `authenticated`. Same
reasoning as every other table in this custom-auth codebase:
`auth.uid()` is always NULL, so RLS policies can't be keyed off it,
and the RPCs are the only write path.

## Super Admin Dashboard

`components/dashboard/SuperAdminDashboard.jsx`, wired into
`DashboardRouter.jsx`. Distinct from `AdminDashboard.jsx` — the two
are never shared or merged.

Reads `users`, `session_logs`, the three permission tables, and
`audit_logs`. Every data source is fetched independently; failures
degrade the "System Health" tile instead of blanking the page (see
the `safe()` helper).

The "Quick access" grid links to `/users`, `/permissions`,
`/password-reset-requests`, `/audit-logs`. "Module Management" and
"Role & Permission Management" both point at `/permissions` on
purpose — one page covers both. Do not build a second page to make
labels 1:1 with routes.
