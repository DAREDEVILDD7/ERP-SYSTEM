import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { ROLES, canAccess as staticCanAccess } from '../lib/rolePermissions';

/* ---------------------------------------------------------------------------
 * PermissionsContext
 *
 * The real, DB-backed source of truth for "what can this user do" - replaces
 * the purely static ROLE_NAV/PERMISSIONS matrix in lib/rolePermissions.js as
 * the thing routes/sidebar/pages actually gate on. That static matrix still
 * exists and still runs (each page's existing canWrite/canApprove constants
 * keep calling hasPermission() exactly as before) - this context's canEdit()
 * is ANDed on top of it, never replacing it, so a Super Admin can always
 * further RESTRICT a module live, but a DB row can never grant more than the
 * existing fine-grained checks already allow. canView()/isModuleEnabled(),
 * used by ProtectedRoute/Sidebar (which had no fine-grained checks to begin
 * with), are a full replacement of the old coarse canAccess().
 *
 * Real-time: subscribes (via the existing useRealtimeRefresh hook, same
 * pattern already used by every other realtime-backed page in this app) to
 * role_permissions / modules / user_permission_overrides / users, so a
 * change made by a Super Admin on one screen reaches every other active
 * session within the hook's debounce window - no logout required.
 *
 * Revocation: if the CURRENT user's own `users.is_active` flips to false
 * while they are signed in, this context signs them out immediately (via
 * AuthContext's existing logout()) rather than waiting for their next
 * request to fail with a permission error.
 *
 * Live role refresh: if the CURRENT user's own `users.role` changes (a
 * Super Admin promotes/demotes them) while they are signed in, this
 * context calls AuthContext's updateProfileRole() so DashboardRouter
 * switches to the new role's dashboard immediately - no re-login required.
 *
 * Fail-safe: any fetch failure (network blip, table not yet migrated, etc.)
 * falls back to the static rolePermissions.js matrix rather than locking
 * everyone out or crashing - "handle all exceptions, maintain
 * responsiveness" applies here as much as anywhere else in the app.
 * ------------------------------------------------------------------------- */

const PermissionsContext = createContext(null);

// user_module_overrides added so a Super Admin's per-user module toggle
// reaches every open session live (same debounce window as the role-level
// changes) without a logout. Same subscription pattern this hook already
// uses for the sibling tables - no new plumbing.
const REALTIME_TABLES = [
  'role_permissions',
  'modules',
  'user_permission_overrides',
  'user_module_overrides',
  'users',
];

export function PermissionsProvider({ children }) {
  const { profile, logout, updateProfileRole } = useAuth();
  const [rolePerms, setRolePerms] = useState(null); // Map<"role:module", {can_view, can_edit}>
  const [moduleMap, setModuleMap] = useState(null); // Map<module_key, is_enabled>
  const [overrides, setOverrides] = useState(null);  // Map<permission_key, granted> - current user only
  const [moduleOverrides, setModuleOverrides] = useState(null); // Map<module_key, {can_view, can_edit}> - current user only
  const [source,    setSource]    = useState('loading'); // 'db' | 'fallback'
  const lastKnownActive = useRef(null);
  const lastKnownRole   = useRef(null);

  const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN;

  const load = useCallback(async () => {
    if (!profile?.user_id) return;
    try {
      const [rpRes, modRes, ovRes, umoRes, userRes] = await Promise.all([
        supabase.from('role_permissions').select('role,module_key,can_view,can_edit'),
        supabase.from('modules').select('module_key,is_enabled'),
        supabase.from('user_permission_overrides').select('permission_key,granted').eq('user_id', profile.user_id),
        // Per-user module override: only the CURRENT user's own rows. Other
        // users' overrides are not loaded here - they don't affect this
        // session's evaluation and the Super Admin management UI fetches
        // them on demand from its own read helper.
        supabase.from('user_module_overrides').select('module_key,can_view,can_edit').eq('user_id', profile.user_id),
        supabase.from('users').select('is_active,role').eq('user_id', profile.user_id).single(),
      ]);
      if (rpRes.error) throw rpRes.error;
      if (modRes.error) throw modRes.error;

      setRolePerms(new Map((rpRes.data ?? []).map(r => [`${r.role}:${r.module_key}`, { can_view: r.can_view, can_edit: r.can_edit }])));
      setModuleMap(new Map((modRes.data ?? []).map(m => [m.module_key, m.is_enabled])));
      setOverrides(new Map((ovRes.data ?? []).map(o => [o.permission_key, o.granted])));
      // user_module_overrides is intentionally optional at the fetch layer:
      // if the migration for this table hasn't been applied on a given
      // environment yet, the query fails but everything else - role perms,
      // modules, keyed overrides - still loads cleanly. Same fail-safe
      // stance as the existing fallback below.
      setModuleOverrides(new Map(
        (umoRes && !umoRes.error ? (umoRes.data ?? []) : [])
          .map(o => [o.module_key, { can_view: o.can_view, can_edit: o.can_edit }])
      ));
      setSource('db');

      const isActiveNow = userRes.data?.is_active;
      if (lastKnownActive.current === null) {
        lastKnownActive.current = isActiveNow ?? true;
      } else if (isActiveNow === false && lastKnownActive.current !== false) {
        lastKnownActive.current = false;
        logout();
        return;
      } else {
        lastKnownActive.current = isActiveNow ?? lastKnownActive.current;
      }

      const roleNow = userRes.data?.role;
      if (lastKnownRole.current === null) {
        lastKnownRole.current = roleNow ?? profile.role;
      } else if (roleNow && roleNow !== lastKnownRole.current) {
        lastKnownRole.current = roleNow;
        updateProfileRole(roleNow);
      }
    } catch (err) {
      console.warn('[Permissions] DB fetch failed, falling back to static defaults:', err?.message ?? err);
      setSource('fallback');
    }
  }, [profile?.user_id, profile?.role, logout, updateProfileRole]);

  useEffect(() => {
    // Reset both baselines whenever the signed-in user changes (new login,
    // not a role/active flip on the same user).
    lastKnownActive.current = null;
    lastKnownRole.current = null;
    load();
  }, [load]);

  useRealtimeRefresh(REALTIME_TABLES, load);

  // Evaluation order for both canView and canEdit:
  //   1. Super Admin → unconditional true (bypass everything below)
  //   2. User-level override for this module → use it verbatim
  //   3. Role permission for this role × module → use it
  //   4. Default deny
  // (The `source !== 'db'` fallback path keeps the existing static-matrix
  // behaviour whenever the DB read has failed entirely, so a network blip
  // or a fresh environment without the migration cannot lock everyone out.)
  const canView = useCallback((moduleKey) => {
    if (isSuperAdmin) return true;
    if (source !== 'db') return staticCanAccess(profile?.role, moduleKey);
    const override = moduleOverrides?.get(moduleKey);
    if (override) return override.can_view;
    return rolePerms?.get(`${profile?.role}:${moduleKey}`)?.can_view ?? false;
  }, [isSuperAdmin, source, moduleOverrides, rolePerms, profile?.role]);

  const isModuleEnabled = useCallback((moduleKey) => {
    if (source !== 'db') return true; // no module-disable concept in the static fallback
    return moduleMap?.get(moduleKey) ?? true;
  }, [source, moduleMap]);

  // Deliberately NOT isModuleEnabled('system_maintenance'): that helper's
  // `?? true` default is the correct safe choice for ordinary nav modules
  // (don't hide things because a row hasn't been seeded yet), but it is
  // exactly backwards for this one flag - if the row is simply missing
  // (migration not yet run, or not yet applied on a fresh environment),
  // reading that as "maintenance is ON" would lock out every non-Super-
  // Admin user for a reason nobody ever chose. Strict `=== true`: only an
  // explicit, present, true value ever turns maintenance mode on.
  const isMaintenanceModeOn = moduleMap?.get('system_maintenance') === true;

  // Super Admin is immune to every Roles-&-Permissions change. `canView`
  // already bypasses to true, and `admin_set_role_permission` /
  // `admin_set_user_module_override` both refuse to store rows against
  // 'Super Admin', so the role-grid and per-user-override paths cannot
  // touch this account. The one remaining path is a Super Admin disabling
  // a module system-wide via `admin_set_module_enabled` - without the
  // early-return below, `isModuleEnabled` would fall through to false and
  // hide the module from the Super Admin themselves (including the toggle
  // that turned it off, locking them out of undoing it). Bypassing
  // isModuleEnabled here keeps them above module toggles the same way
  // ProtectedRoute already keeps them above maintenance mode.
  const canAccessModule = useCallback(
    (moduleKey) => {
      if (isSuperAdmin) return true;
      return canView(moduleKey) && isModuleEnabled(moduleKey);
    },
    [isSuperAdmin, canView, isModuleEnabled],
  );

  const canEdit = useCallback((moduleKey) => {
    if (isSuperAdmin) return true;
    if (source !== 'db') return true; // defer entirely to the existing static hasPermission() check at the call site
    const override = moduleOverrides?.get(moduleKey);
    const effectiveEdit = override
      ? override.can_edit
      : (rolePerms?.get(`${profile?.role}:${moduleKey}`)?.can_edit ?? false);
    return effectiveEdit && isModuleEnabled(moduleKey);
  }, [isSuperAdmin, source, moduleOverrides, rolePerms, profile?.role, isModuleEnabled]);

  const canResetPasswords = isSuperAdmin || (overrides?.get('password_reset') ?? false);

  // Memoised so every consumer (Sidebar, MobileNav, ProtectedRoute, and
  // every page that reads permissions) only re-renders when the semantic
  // value actually changes. Without this, a fresh object literal is
  // handed to the provider on every render of PermissionsProvider itself
  // - which happens on any state flip inside it (rolePerms/moduleMap/
  // overrides/moduleOverrides/source) - and every consumer re-renders in
  // lockstep even when their observable value is identical. The functions
  // in this value are already useCallback-wrapped, and the booleans are
  // primitives, so === dependency checks here are exact and safe.
  const contextValue = useMemo(() => ({
    isSuperAdmin, canView, isModuleEnabled, canAccessModule, canEdit,
    canResetPasswords, isMaintenanceModeOn, reloadPermissions: load,
  }), [
    isSuperAdmin, canView, isModuleEnabled, canAccessModule, canEdit,
    canResetPasswords, isMaintenanceModeOn, load,
  ]);

  return (
    <PermissionsContext.Provider value={contextValue}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
