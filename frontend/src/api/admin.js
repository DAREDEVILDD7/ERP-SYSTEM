import { supabase } from '../lib/supabaseClient';

// Super Admin RPCs (see add_super_admin_rbac.sql). Every call takes the
// acting user's own id explicitly rather than trusting anything from the
// client beyond that identity - the RPC itself re-verifies the actor's role
// (and, where relevant, a target-privilege-ceiling rule) fresh from the
// `users` table on every call. Same convention as api/passwordResetRequests.js.

export async function adminSetUserRole(actorId, targetId, newRole) {
  const { error } = await supabase.rpc('admin_set_user_role', {
    p_actor_id: actorId, p_target_id: targetId, p_new_role: newRole,
  });
  if (error) throw new Error(error.message || 'Failed to change role.');
}

export async function adminSetUserActive(actorId, targetId, isActive) {
  const { error } = await supabase.rpc('admin_set_user_active', {
    p_actor_id: actorId, p_target_id: targetId, p_is_active: isActive,
  });
  if (error) throw new Error(error.message || 'Failed to update user status.');
}

export async function adminCreateUser(actorId, { name, username, email, role, department, password }) {
  const { data, error } = await supabase.rpc('admin_create_user', {
    p_actor_id: actorId, p_name: name, p_username: username, p_email: email,
    p_role: role, p_department: department, p_password: password,
  });
  if (error) throw new Error(error.message || 'Failed to create user.');
  return data; // new user_id
}

export async function adminSetRolePermission(actorId, role, moduleKey, canView, canEdit) {
  const { error } = await supabase.rpc('admin_set_role_permission', {
    p_actor_id: actorId, p_role: role, p_module_key: moduleKey,
    p_can_view: canView, p_can_edit: canEdit,
  });
  if (error) throw new Error(error.message || 'Failed to update permission.');
}

export async function adminSetModuleEnabled(actorId, moduleKey, isEnabled) {
  const { error } = await supabase.rpc('admin_set_module_enabled', {
    p_actor_id: actorId, p_module_key: moduleKey, p_is_enabled: isEnabled,
  });
  if (error) throw new Error(error.message || 'Failed to update module.');
}

export async function adminGrantUserPermission(actorId, targetId, permissionKey, granted) {
  const { error } = await supabase.rpc('admin_grant_user_permission', {
    p_actor_id: actorId, p_target_id: targetId, p_permission_key: permissionKey, p_granted: granted,
  });
  if (error) throw new Error(error.message || 'Failed to update permission grant.');
}

// Per-user, per-module override. Presence of a row for (target, module) makes
// PermissionsContext evaluate against those values verbatim, ignoring the
// target's role permission for that module. Absence of a row = "inherit from
// role"; use adminClearUserModuleOverride below to reach that state.
export async function adminSetUserModuleOverride(actorId, targetId, moduleKey, canView, canEdit) {
  const { error } = await supabase.rpc('admin_set_user_module_override', {
    p_actor_id: actorId, p_target_id: targetId, p_module_key: moduleKey,
    p_can_view: canView, p_can_edit: canEdit,
  });
  if (error) throw new Error(error.message || 'Failed to update user permission override.');
}

export async function adminClearUserModuleOverride(actorId, targetId, moduleKey) {
  const { error } = await supabase.rpc('admin_clear_user_module_override', {
    p_actor_id: actorId, p_target_id: targetId, p_module_key: moduleKey,
  });
  if (error) throw new Error(error.message || 'Failed to clear user permission override.');
}

// ── read helpers (plain SELECTs - all three tables grant SELECT to anon/authenticated) ──

export async function getRolePermissions() {
  const { data, error } = await supabase.from('role_permissions').select('*').order('role');
  if (error) throw error;
  return data ?? [];
}

export async function getModules() {
  const { data, error } = await supabase.from('modules').select('*').order('module_key');
  if (error) throw error;
  return data ?? [];
}

export async function getUserPermissionOverrides() {
  const { data, error } = await supabase.from('user_permission_overrides').select('*');
  if (error) throw error;
  return data ?? [];
}

// Per-user module overrides. When targetId is passed, only that user's rows
// are returned - used by the User Management edit dialog which is scoped to
// a single user at a time. When omitted, returns everything.
export async function getUserModuleOverrides(targetId) {
  let query = supabase.from('user_module_overrides').select('*');
  if (targetId) query = query.eq('user_id', targetId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getAdminAuditLog(limit = 500) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
