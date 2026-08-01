-- ═══════════════════════════════════════════════════════════════════════════
-- Password-reset authorization — server-side enforcement
--
-- Closes the "known gap" documented in handoff.md: the 5 pre-existing
-- password-reset RPCs (list / get / start / complete / reject in
-- password_reset_requests.sql) all gate on `_is_active_admin`, which today
-- checks `role = 'Admin' AND is_active`. That has two failure modes vs.
-- the product requirement:
--
--   1. A Super Admin cannot call any of them (their role is 'Super Admin',
--      not 'Admin'), so the "Super Admin must always have permission to
--      view, process, and complete all password reset requests" line of
--      the requirement fails at the RPC boundary even though the client
--      already treats Super Admin as authorized.
--
--   2. Any active Admin can call them regardless of whether they hold
--      the fine-grained `password_reset` grant in `user_permission_overrides`.
--      The Super Admin's "grant / revoke" toggle in Roles & Permissions
--      is enforced client-side only; a stale tab, a direct curl, or any
--      script bypasses it.
--
-- The fix is a single-function redefine: `_is_active_admin` now delegates
-- to `fn_can_reset_passwords` (defined in add_super_admin_rbac.sql), which
-- already encodes the correct policy — Super Admin unconditional, plus
-- Admin-with-password_reset-grant. None of the 5 RPC bodies change; they
-- all delegate to the same helper name and inherit the new semantics.
-- Function name is preserved deliberately so no RPC body has to be
-- rewritten; its semantics have widened from "is this an active Admin"
-- to "is this user authorized to process password reset requests" and
-- the header comment on the redefine says so explicitly.
--
-- Also strengthens `admin_grant_user_permission` to refuse writes against
-- a Super Admin target or against the actor's own account — matching the
-- immunity discipline already used by `admin_set_user_module_override`
-- and `admin_set_role_permission`. The runtime bypass would ignore such a
-- row anyway, but failing loud at the write layer keeps the
-- "cannot be revoked, even by another Super Admin" contract explicit at
-- the storage boundary.
--
-- Real-time revocation was already in place: `user_permission_overrides`
-- is in `PermissionsContext.REALTIME_TABLES`, so the moment the Super
-- Admin toggles a grant off, the affected Admin's browser re-runs
-- `canResetPasswords`, the sidebar / mobile-nav hide the "Password
-- Resets" item, `PasswordResetRequests` renders the "permission required"
-- state, and any subsequent RPC call now also fails server-side thanks
-- to this migration. No client changes are required — this file is
-- entirely SQL.
--
-- Depends on: add_super_admin_rbac.sql (for `fn_can_reset_passwords`
-- and `fn_is_super_admin`) and password_reset_requests.sql (for
-- `_is_active_admin` and the 5 RPCs that call it). Both must be applied
-- before this file. Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Redefine `_is_active_admin` to enforce the new policy ────────────────
--
-- The 5 RPCs in password_reset_requests.sql all say
--   `IF NOT _is_active_admin(p_admin_user_id) THEN
--      RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
--    END IF;`
-- Delegating to `fn_can_reset_passwords` means every one of those checks
-- now returns the correct answer for both Super Admin (always yes) and
-- Admin (yes iff granted). Signature is preserved so no callsite anywhere
-- in the app or DB has to change.
CREATE OR REPLACE FUNCTION _is_active_admin(p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Widened intent: was "is this user an active Admin", is now
  -- "is this user authorized to process password reset requests".
  -- Delegates to the single source of truth (fn_can_reset_passwords in
  -- add_super_admin_rbac.sql) so the client's `canResetPasswords` and
  -- the server's RPC gate cannot drift apart.
  SELECT fn_can_reset_passwords(p_user_id);
$$;

-- ── 2. Immunity guard on the grant RPC itself ───────────────────────────────
--
-- `admin_grant_user_permission` is the only write path into
-- `user_permission_overrides`. Refusing Super Admin targets and
-- actor-on-self makes the "Super Admin's password_reset cannot be
-- revoked" property enforced at write time, not just at evaluation time.
-- Client UI already only surfaces role='Admin' users in the grant list,
-- but a stale client, a script, or a direct RPC call could otherwise
-- write an incoherent row (`granted=false` for a Super Admin) that the
-- runtime would silently ignore.
CREATE OR REPLACE FUNCTION admin_grant_user_permission(
  p_actor_id text, p_target_id text, p_permission_key text, p_granted boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT fn_is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Only Super Admin can grant individual permissions.';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'You cannot change a grant on your own Super Admin account.';
  END IF;

  SELECT role INTO v_target_role FROM users WHERE user_id = p_target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
  IF v_target_role = 'Super Admin' THEN
    -- Super Admin's password_reset (and every other) permission is
    -- unconditional and cannot be revoked - see fn_can_reset_passwords
    -- and fn_is_super_admin. Blocking the write keeps the storage
    -- coherent with the runtime bypass.
    RAISE EXCEPTION 'Super Admin permissions are unconditional and cannot be granted or revoked.';
  END IF;

  INSERT INTO user_permission_overrides (user_id, permission_key, granted, granted_by)
  VALUES (p_target_id, p_permission_key, p_granted, p_actor_id)
  ON CONFLICT (user_id, permission_key) DO UPDATE
    SET granted = excluded.granted, granted_by = p_actor_id, granted_at = now();

  PERFORM fn_log_admin_action(p_actor_id, 'PERMISSION_GRANT', 'user_permission_overrides',
    p_target_id || ':' || p_permission_key, NULL, jsonb_build_object('granted', p_granted));
END;
$$;

-- ── 3. Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_delegates_ok boolean;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ password_reset authorization — Verification ══';

  -- Verify _is_active_admin is now defined via fn_can_reset_passwords.
  -- We check the body contains the delegation call rather than the old
  -- 'role = Admin' predicate, so re-runs of this file are self-detecting.
  SELECT (pg_get_functiondef(oid) ILIKE '%fn_can_reset_passwords%')
    INTO v_delegates_ok
  FROM pg_proc
  WHERE proname = '_is_active_admin' AND pronargs = 1
  LIMIT 1;

  IF v_delegates_ok THEN
    RAISE NOTICE '  ✓ _is_active_admin now delegates to fn_can_reset_passwords.';
  ELSE
    RAISE WARNING '  ✗ _is_active_admin does not delegate as expected - re-run this file.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'admin_grant_user_permission'
      AND pg_get_functiondef(oid) ILIKE '%Super Admin permissions are unconditional%'
  ) THEN
    RAISE NOTICE '  ✓ admin_grant_user_permission refuses Super Admin targets.';
  ELSE
    RAISE WARNING '  ✗ admin_grant_user_permission not updated - re-run this file.';
  END IF;

  RAISE NOTICE '══════════════════════════════════════════════════';
END $$;
