-- ═══════════════════════════════════════════════════════════════════════════
-- Super Admin role + DB-backed permission system — STEP 2 of 2
--
-- Adds a "Super Admin" role above today's "Admin", plus a real, database-
-- driven per-role/per-module permission model that Super Admin can edit
-- live (no redeploy, no logout — the frontend subscribes to these tables
-- via Supabase realtime, same pattern as `notifications`/`session_logs`).
--
-- Same architecture as every other privileged action in this codebase:
-- this app has its own username/password login (verify_login RPC), never
-- a real Supabase Auth session, so auth.uid() is always null and RLS
-- cannot be keyed off it. All three new tables below keep RLS OFF and are
-- SELECT-only for anon/authenticated (every client needs to read its own
-- effective permissions) - the only way to WRITE any of them is through
-- the SECURITY DEFINER RPCs further down, each of which re-verifies the
-- acting user's role from `users` fresh on every call. This is the actual
-- "never rely on client-side authorization alone" enforcement boundary.
--
-- ── Already run (do not re-execute here) ────────────────────────────────────
--   STEP 1 (own transaction):
--     ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Super Admin';
--   Postgres requires new enum values to commit BEFORE they can be used,
--   so step 1 had to run on its own before this file's later references
--   to 'Super Admin' become legal. This has already been done successfully
--   against the target database.
--
--   If you ever need to re-run this migration against a FRESH database,
--   paste and run the ALTER TYPE above on its own first, then paste and
--   run the rest of this file.
--
--   The one-shot diagnostic that dumped the 5 existing password-reset
--   RPC bodies also lived above this line; it was a one-time read-only
--   query and has been removed to keep this file idempotent.
--
-- Safe to run multiple times. Paste everything below into Supabase SQL
-- Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 2. Permission tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_permissions (
  role       text NOT NULL,
  module_key text NOT NULL,
  can_view   boolean NOT NULL DEFAULT false,
  can_edit   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (role, module_key)
);
-- Deliberately no rows for 'Super Admin' - its access is an unconditional
-- bypass in fn_effective_permission() below, so a missing/bad row here can
-- never lock a Super Admin out of their own system.

CREATE TABLE IF NOT EXISTS modules (
  module_key text PRIMARY KEY,
  label      text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id        text NOT NULL REFERENCES users(user_id),
  permission_key text NOT NULL,
  granted        boolean NOT NULL DEFAULT false,
  granted_by     text,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);
-- Used today only for permission_key = 'password_reset' (grants a specific
-- Admin the right to process password-reset requests, off by default), but
-- keyed generically so future per-user grants don't need a new table.

ALTER TABLE role_permissions          DISABLE ROW LEVEL SECURITY;
ALTER TABLE modules                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_overrides  DISABLE ROW LEVEL SECURITY;

GRANT SELECT ON role_permissions, modules, user_permission_overrides TO anon, authenticated;
-- No INSERT/UPDATE/DELETE grants on purpose - only the RPCs below can write.

-- ── 3. Seed: reproduce today's exact ROLE_NAV / PERMISSIONS matrix ───────────
-- (frontend/src/lib/rolePermissions.js) so nothing regresses the moment
-- this migration runs. can_edit mirrors can_view here on purpose: the new
-- coarse per-module toggle is ANDed with the EXISTING fine-grained static
-- checks in each page (requirements_create, quotations_create, etc.), which
-- keep working exactly as today - this seed only needs to avoid being MORE
-- restrictive than today, never needs to reproduce the fine sub-permission
-- boundaries itself.
INSERT INTO modules (module_key, label) VALUES
  ('dashboard',                'Dashboard'),
  ('requirements',             'Requirements'),
  ('quotations',               'Quotations'),
  ('equipment',                'Operations / Equipment'),
  ('dispatch',                 'Dispatch'),
  ('maintenance',              'Maintenance'),
  ('finance',                  'Finance'),
  ('procurement',              'Procurement'),
  ('customers',                'Customers'),
  ('chat',                     'Chat'),
  ('users',                    'User Management'),
  ('audit-logs',               'Audit Logs'),
  ('password-reset-requests',  'Password Reset Requests'),
  ('permissions',              'Roles & Permissions')
ON CONFLICT (module_key) DO NOTHING;

-- Not a nav item - a system-wide lockout switch for every non-Super-Admin
-- user, toggled from the Super Admin Dashboard's "Maintenance Mode" card.
-- Explicit is_enabled=false: this must default OFF, unlike every other
-- module above (which default to the column's own true default, matching
-- today's fully-open behaviour). Distinct key from 'maintenance' (the
-- equipment-maintenance business module) to avoid any naming collision.
INSERT INTO modules (module_key, label, is_enabled) VALUES
  ('system_maintenance', 'Maintenance Mode (system-wide)', false)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO role_permissions (role, module_key, can_view, can_edit) VALUES
  ('Admin','dashboard',true,true), ('Admin','requirements',true,true), ('Admin','quotations',true,true),
  ('Admin','equipment',true,true), ('Admin','dispatch',true,true), ('Admin','maintenance',true,true),
  ('Admin','finance',true,true), ('Admin','procurement',true,true), ('Admin','customers',true,true),
  ('Admin','chat',true,true), ('Admin','users',true,true), ('Admin','audit-logs',true,true),
  ('Admin','password-reset-requests',true,true),

  ('Sales Executive','dashboard',true,true), ('Sales Executive','requirements',true,true),
  ('Sales Executive','quotations',true,true), ('Sales Executive','customers',true,true),
  ('Sales Executive','equipment',true,true), ('Sales Executive','chat',true,true),

  ('Operations Manager','dashboard',true,true), ('Operations Manager','requirements',true,true),
  ('Operations Manager','quotations',true,true), ('Operations Manager','equipment',true,true),
  ('Operations Manager','dispatch',true,true), ('Operations Manager','maintenance',true,true),
  ('Operations Manager','chat',true,true),

  ('Warehouse Operator','dashboard',true,true), ('Warehouse Operator','equipment',true,true),
  ('Warehouse Operator','maintenance',true,true), ('Warehouse Operator','chat',true,true),

  ('Dispatch Coordinator','dashboard',true,true), ('Dispatch Coordinator','dispatch',true,true),
  ('Dispatch Coordinator','equipment',true,true), ('Dispatch Coordinator','chat',true,true),

  ('Finance Officer','dashboard',true,true), ('Finance Officer','quotations',true,true),
  ('Finance Officer','finance',true,true), ('Finance Officer','procurement',true,true),
  ('Finance Officer','customers',true,true), ('Finance Officer','chat',true,true),

  ('Maintenance Engineer','dashboard',true,true), ('Maintenance Engineer','maintenance',true,true),
  ('Maintenance Engineer','equipment',true,true), ('Maintenance Engineer','chat',true,true),

  ('Procurement Manager','dashboard',true,true), ('Procurement Manager','requirements',true,true),
  ('Procurement Manager','quotations',true,true), ('Procurement Manager','procurement',true,true),
  ('Procurement Manager','equipment',true,true), ('Procurement Manager','finance',true,true),
  ('Procurement Manager','chat',true,true),

  ('Head of IT','dashboard',true,true), ('Head of IT','requirements',true,true),
  ('Head of IT','users',true,true), ('Head of IT','audit-logs',true,true),
  ('Head of IT','equipment',true,true), ('Head of IT','maintenance',true,true),
  ('Head of IT','procurement',true,true), ('Head of IT','chat',true,true)
ON CONFLICT (role, module_key) DO NOTHING;

-- ── 4. Helper functions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_is_super_admin(p_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE user_id = p_user_id AND role = 'Super Admin' AND COALESCE(is_active, true)
  );
$$;

CREATE OR REPLACE FUNCTION fn_can_reset_passwords(p_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fn_is_super_admin(p_user_id) OR EXISTS (
    SELECT 1 FROM user_permission_overrides
    WHERE user_id = p_user_id AND permission_key = 'password_reset' AND granted
  );
$$;

-- Privilege-ceiling check used by every user-management RPC below: an actor
-- may act on a target if they are Super Admin, OR if the target's CURRENT
-- role is strictly below Admin/Super Admin (prevents a regular Admin from
-- ever touching another Admin or a Super Admin - "prevent users from
-- modifying roles/permissions above their own privilege level").
CREATE OR REPLACE FUNCTION fn_can_manage_target(p_actor_id text, p_target_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target_role text;
BEGIN
  IF fn_is_super_admin(p_actor_id) THEN RETURN true; END IF;
  SELECT role INTO v_target_role FROM users WHERE user_id = p_target_id;
  RETURN v_target_role IS NOT NULL AND v_target_role NOT IN ('Admin','Super Admin');
END;
$$;

CREATE OR REPLACE FUNCTION fn_log_admin_action(
  p_actor_id text, p_action text, p_table_name text, p_record_id text,
  p_old_values jsonb DEFAULT NULL, p_new_values jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (p_actor_id, p_action, p_table_name, p_record_id, p_old_values, p_new_values);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fn_log_admin_action] action=% err=%', p_action, SQLERRM;
END;
$$;

-- ── 5. User-management RPCs ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_user_role(p_actor_id text, p_target_id text, p_new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_role text; v_other_super_admins int;
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can change a user''s role.';
  END IF;

  SELECT role INTO v_old_role FROM users WHERE user_id = p_target_id;
  IF v_old_role IS NULL THEN RAISE EXCEPTION 'User not found.'; END IF;

  IF v_old_role = 'Super Admin' AND p_new_role <> 'Super Admin' THEN
    SELECT count(*) INTO v_other_super_admins FROM users
      WHERE role = 'Super Admin' AND user_id <> p_target_id AND COALESCE(is_active, true);
    IF v_other_super_admins = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last remaining active Super Admin.';
    END IF;
  END IF;

  UPDATE users SET role = p_new_role, updated_at = now() WHERE user_id = p_target_id;
  PERFORM fn_log_admin_action(p_actor_id, 'ROLE_CHANGE', 'users', p_target_id,
    jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role));
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_user_active(p_actor_id text, p_target_id text, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_active boolean;
BEGIN
  IF NOT fn_can_manage_target(p_actor_id, p_target_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this user''s status.';
  END IF;

  SELECT is_active INTO v_old_active FROM users WHERE user_id = p_target_id;
  IF v_old_active IS NULL THEN RAISE EXCEPTION 'User not found.'; END IF;

  UPDATE users SET is_active = p_is_active, updated_at = now() WHERE user_id = p_target_id;
  PERFORM fn_log_admin_action(p_actor_id, CASE WHEN p_is_active THEN 'USER_ACTIVATED' ELSE 'USER_DEACTIVATED' END,
    'users', p_target_id, jsonb_build_object('is_active', v_old_active), jsonb_build_object('is_active', p_is_active));
END;
$$;

CREATE OR REPLACE FUNCTION admin_reset_user_password(p_actor_id text, p_target_id text, p_new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_can_reset_passwords(p_actor_id) THEN
    RAISE EXCEPTION 'You do not have permission to reset passwords.';
  END IF;
  IF NOT fn_can_manage_target(p_actor_id, p_target_id) THEN
    RAISE EXCEPTION 'You do not have permission to reset this user''s password.';
  END IF;

  -- Reuses the existing, already-correct hashing path - never reimplemented here.
  PERFORM set_user_password(p_target_id, p_new_password);
  PERFORM fn_log_admin_action(p_actor_id, 'PASSWORD_RESET', 'users', p_target_id, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION admin_create_user(
  p_actor_id text, p_name text, p_username text, p_email text,
  p_role text, p_department text, p_password text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_id text;
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can create users.';
  END IF;

  INSERT INTO users (name, username, email, role, department, is_active)
  VALUES (p_name, p_username, p_email, p_role, p_department, true)
  RETURNING user_id INTO v_new_id;

  -- Reuses the existing, already-correct hashing path - never reimplemented here.
  PERFORM set_user_password(v_new_id, p_password);

  PERFORM fn_log_admin_action(p_actor_id, 'USER_CREATED', 'users', v_new_id, NULL,
    jsonb_build_object('name', p_name, 'username', p_username, 'role', p_role, 'department', p_department));
  RETURN v_new_id;
END;
$$;

-- ── 6. Permission/module management RPCs (Super Admin only) ─────────────────

CREATE OR REPLACE FUNCTION admin_set_role_permission(
  p_actor_id text, p_role text, p_module_key text, p_can_view boolean, p_can_edit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can change role permissions.';
  END IF;
  IF p_role = 'Super Admin' THEN
    RAISE EXCEPTION 'Super Admin access is unconditional and cannot be edited.';
  END IF;

  INSERT INTO role_permissions (role, module_key, can_view, can_edit, updated_by)
  VALUES (p_role, p_module_key, p_can_view, p_can_edit, p_actor_id)
  ON CONFLICT (role, module_key) DO UPDATE
    SET can_view = excluded.can_view, can_edit = excluded.can_edit,
        updated_at = now(), updated_by = p_actor_id;

  PERFORM fn_log_admin_action(p_actor_id, 'PERMISSION_CHANGE', 'role_permissions', p_role || ':' || p_module_key,
    NULL, jsonb_build_object('can_view', p_can_view, 'can_edit', p_can_edit));
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_module_enabled(p_actor_id text, p_module_key text, p_is_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can enable or disable modules.';
  END IF;

  UPDATE modules SET is_enabled = p_is_enabled, updated_at = now(), updated_by = p_actor_id
  WHERE module_key = p_module_key;

  PERFORM fn_log_admin_action(p_actor_id, 'MODULE_TOGGLE', 'modules', p_module_key,
    NULL, jsonb_build_object('is_enabled', p_is_enabled));
END;
$$;

CREATE OR REPLACE FUNCTION admin_grant_user_permission(
  p_actor_id text, p_target_id text, p_permission_key text, p_granted boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can grant individual permissions.';
  END IF;

  INSERT INTO user_permission_overrides (user_id, permission_key, granted, granted_by)
  VALUES (p_target_id, p_permission_key, p_granted, p_actor_id)
  ON CONFLICT (user_id, permission_key) DO UPDATE
    SET granted = excluded.granted, granted_by = p_actor_id, granted_at = now();

  PERFORM fn_log_admin_action(p_actor_id, 'PERMISSION_GRANT', 'user_permission_overrides',
    p_target_id || ':' || p_permission_key, NULL, jsonb_build_object('granted', p_granted));
END;
$$;

GRANT EXECUTE ON FUNCTION
  fn_is_super_admin(text), fn_can_reset_passwords(text), fn_can_manage_target(text, text),
  admin_set_user_role(text, text, text), admin_set_user_active(text, text, boolean),
  admin_reset_user_password(text, text, text), admin_create_user(text, text, text, text, text, text, text),
  admin_set_role_permission(text, text, text, boolean, boolean),
  admin_set_module_enabled(text, text, boolean),
  admin_grant_user_permission(text, text, text, boolean)
TO anon, authenticated;

-- ── 7. Self-test & diagnostics ────────────────────────────────────────────────
DO $$
DECLARE
  v_enum_ok boolean;
  v_rp_count int; v_mod_count int;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ Super Admin RBAC — Verification ══';

  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'Super Admin'
  ) INTO v_enum_ok;
  IF v_enum_ok THEN RAISE NOTICE '  ✓ user_role enum has ''Super Admin''.';
  ELSE RAISE WARNING '  ✗ ''Super Admin'' missing from user_role enum.'; END IF;

  SELECT count(*) INTO v_rp_count FROM role_permissions;
  SELECT count(*) INTO v_mod_count FROM modules;
  RAISE NOTICE '  role_permissions rows: % · modules rows: %', v_rp_count, v_mod_count;
  IF v_rp_count = 0 OR v_mod_count = 0 THEN
    RAISE WARNING '  ✗ Seed data looks empty — check the INSERT statements above.';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE role = 'Super Admin') THEN
    RAISE NOTICE '  ✓ At least one Super Admin user already exists.';
  ELSE
    RAISE NOTICE '  (no Super Admin user yet — promote one via: '
      'UPDATE users SET role = ''Super Admin'' WHERE username = ''<your username>'';)';
  END IF;

  RAISE NOTICE '══════════════════════════════════════';
END $$;
