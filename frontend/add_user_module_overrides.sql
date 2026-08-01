-- ═══════════════════════════════════════════════════════════════════════════
-- User-level module permission overrides (extends add_super_admin_rbac.sql)
--
-- Adds a per-USER override on top of the existing per-ROLE permission
-- matrix, without touching any of the existing role_permissions /
-- user_permission_overrides / modules tables or their RPCs. The
-- evaluation order (implemented on the client in PermissionsContext) is:
--
--    1. Super Admin           → always allow (unconditional bypass)
--    2. User-level override   → this table (if a row is present, use it)
--    3. Role permission       → role_permissions (existing)
--    4. Default deny
--
-- Example: role Sales Executive has chat=on. User John (Sales Executive)
-- gets a row in this table with module='chat', can_view=false → only John
-- loses chat access; every other Sales Executive still sees chat. Same
-- mechanism the other way: Sarah gets a row with module='audit-logs',
-- can_view=true → Sarah gains it without changing the Sales Executive
-- role itself.
--
-- Missing row = "inherit from role" (three-state per user × module:
-- unset / explicitly allowed / explicitly denied). Clearing an override
-- is a DELETE, not a false-write, so the row's absence is always the
-- unambiguous "inherit" state - avoids the "did the Super Admin actually
-- set this, or is it just the row's default?" ambiguity a boolean-only
-- table would have.
--
-- Same architecture as the base RBAC file: RLS OFF, SELECT-only for
-- anon/authenticated (every signed-in client needs to read its own
-- effective permissions in real time), writes go exclusively through
-- the two SECURITY DEFINER RPCs at the bottom, each of which re-verifies
-- the actor is a Super Admin on every call.
--
-- Safe to run multiple times. Paste into Supabase SQL Editor → Run.
-- Runs cleanly on top of an already-applied add_super_admin_rbac.sql;
-- does NOT re-run any of that file's statements.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_module_overrides (
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES modules(module_key) ON DELETE CASCADE,
  can_view   boolean NOT NULL DEFAULT false,
  can_edit   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (user_id, module_key)
);

-- Same RLS/grant posture as role_permissions/modules/user_permission_overrides:
-- clients need to read their OWN effective permissions live, but no client
-- may write directly - the RPCs below are the sole write path.
ALTER TABLE user_module_overrides DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON user_module_overrides TO anon, authenticated;

-- Look-up index for the client's per-user read; PK already covers
-- (user_id, module_key) so a compound WHERE user_id = ... AND module_key = ...
-- is already fast, but a plain (user_id) prefix index isn't automatically
-- created and this makes the "load overrides for one user" query O(hits).
CREATE INDEX IF NOT EXISTS idx_user_module_overrides_user
  ON user_module_overrides (user_id);

-- ── 2. RPCs (Super Admin only, audit-logged) ─────────────────────────────────

-- Set (upsert) an override for one user × one module. Refuses to write
-- against a Super Admin target: that role's access is unconditional (see
-- fn_is_super_admin), so an override on it would be silently ignored by
-- PermissionsContext anyway - failing loud here is clearer than storing a
-- row that has no effect. Also refuses to write for the actor themself:
-- prevents a Super Admin from accidentally locking themselves out via a
-- self-directed override (and would still be a no-op due to the bypass,
-- but again, clarity over silence).
CREATE OR REPLACE FUNCTION admin_set_user_module_override(
  p_actor_id text, p_target_id text, p_module_key text,
  p_can_view boolean, p_can_edit boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_role text;
  v_old_view boolean; v_old_edit boolean;
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can change user permission overrides.';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'You cannot set an override on your own Super Admin account.';
  END IF;

  SELECT role INTO v_target_role FROM users WHERE user_id = p_target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
  IF v_target_role = 'Super Admin' THEN
    RAISE EXCEPTION 'Super Admin access is unconditional; overrides do not apply.';
  END IF;

  -- can_view=false ⇒ can_edit=false at the storage layer too. Storing an
  -- edit right without a view right is meaningless and the client's
  -- canView/canEdit both already enforce this, but persisting the coherent
  -- pair avoids a future reader having to reason about a stale can_edit=true
  -- that no evaluation path can ever surface.
  IF NOT p_can_view THEN p_can_edit := false; END IF;

  SELECT can_view, can_edit INTO v_old_view, v_old_edit
  FROM user_module_overrides
  WHERE user_id = p_target_id AND module_key = p_module_key;

  INSERT INTO user_module_overrides (user_id, module_key, can_view, can_edit, updated_by)
  VALUES (p_target_id, p_module_key, p_can_view, p_can_edit, p_actor_id)
  ON CONFLICT (user_id, module_key) DO UPDATE
    SET can_view = excluded.can_view,
        can_edit = excluded.can_edit,
        updated_at = now(),
        updated_by = p_actor_id;

  PERFORM fn_log_admin_action(
    p_actor_id, 'USER_MODULE_OVERRIDE_SET', 'user_module_overrides',
    p_target_id || ':' || p_module_key,
    CASE WHEN v_old_view IS NULL THEN NULL
         ELSE jsonb_build_object('can_view', v_old_view, 'can_edit', v_old_edit) END,
    jsonb_build_object('can_view', p_can_view, 'can_edit', p_can_edit)
  );
END;
$$;

-- Delete the override for one user × one module. The row's absence is the
-- unambiguous "inherit from role" state - see the file-level comment above.
CREATE OR REPLACE FUNCTION admin_clear_user_module_override(
  p_actor_id text, p_target_id text, p_module_key text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_view boolean; v_old_edit boolean;
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can clear user permission overrides.';
  END IF;

  SELECT can_view, can_edit INTO v_old_view, v_old_edit
  FROM user_module_overrides
  WHERE user_id = p_target_id AND module_key = p_module_key;

  DELETE FROM user_module_overrides
  WHERE user_id = p_target_id AND module_key = p_module_key;

  IF v_old_view IS NOT NULL THEN
    PERFORM fn_log_admin_action(
      p_actor_id, 'USER_MODULE_OVERRIDE_CLEAR', 'user_module_overrides',
      p_target_id || ':' || p_module_key,
      jsonb_build_object('can_view', v_old_view, 'can_edit', v_old_edit),
      NULL
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION
  admin_set_user_module_override(text, text, text, boolean, boolean),
  admin_clear_user_module_override(text, text, text)
TO anon, authenticated;

-- ── 3. Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_table_ok boolean;
  v_set_ok boolean;
  v_clear_ok boolean;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ user_module_overrides — Verification ══';

  SELECT to_regclass('public.user_module_overrides') IS NOT NULL INTO v_table_ok;
  IF v_table_ok THEN RAISE NOTICE '  ✓ user_module_overrides table exists.';
  ELSE RAISE WARNING '  ✗ user_module_overrides table missing.'; END IF;

  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_set_user_module_override') INTO v_set_ok;
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_clear_user_module_override') INTO v_clear_ok;
  IF v_set_ok AND v_clear_ok THEN RAISE NOTICE '  ✓ Set/clear RPCs installed.';
  ELSE RAISE WARNING '  ✗ set=% clear=% (both must be true)', v_set_ok, v_clear_ok; END IF;

  RAISE NOTICE '══════════════════════════════════════════';
END $$;
