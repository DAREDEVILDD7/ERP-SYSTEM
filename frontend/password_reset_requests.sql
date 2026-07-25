-- ═══════════════════════════════════════════════════════════════════════════
-- Password Reset Requests — Admin-Managed Workflow
--
-- This ERP uses a custom login (verify_login RPC against the users table),
-- so every browser request runs as the `anon` Postgres role. auth.uid() is
-- always NULL. All privileged operations therefore travel through
-- SECURITY DEFINER RPCs that validate the caller's identity/role by
-- p_admin_user_id (mirroring the existing pattern used elsewhere in the
-- codebase).
--
-- Safe to run multiple times. Paste into Supabase SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Cleanup (idempotent) ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS submit_password_reset_request(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS submit_password_reset_request(TEXT);
DROP FUNCTION IF EXISTS admin_list_password_reset_requests(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS admin_list_password_reset_requests(TEXT);
DROP FUNCTION IF EXISTS admin_get_password_reset_request(TEXT, UUID);
DROP FUNCTION IF EXISTS admin_start_password_reset_request(TEXT, UUID);
DROP FUNCTION IF EXISTS admin_complete_password_reset_request(TEXT, UUID);
DROP FUNCTION IF EXISTS admin_reject_password_reset_request(TEXT, UUID, TEXT);

-- ── 1. Main table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_requests (
  request_id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  requested_username  TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending','In Progress','Completed','Rejected')),
  processed_by        TEXT        REFERENCES users(user_id) ON DELETE SET NULL,
  processed_at        TIMESTAMPTZ,
  reject_reason       TEXT,
  source_ip           TEXT,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prr_user_created   ON password_reset_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prr_status_created ON password_reset_requests (status, created_at DESC);
-- One outstanding request per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS ux_prr_one_open_per_user
  ON password_reset_requests (user_id)
  WHERE status IN ('Pending','In Progress');

-- ── 2. Immutable audit log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_audit_log (
  audit_id       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id     UUID        REFERENCES password_reset_requests(request_id) ON DELETE SET NULL,
  actor_user_id  TEXT        REFERENCES users(user_id) ON DELETE SET NULL,
  subject_user_id TEXT       REFERENCES users(user_id) ON DELETE SET NULL,
  attempted_username TEXT,
  action         TEXT        NOT NULL,
  notes          TEXT,
  source_ip      TEXT,
  user_agent     TEXT,
  action_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prr_audit_action_time ON password_reset_audit_log (action_at DESC);
CREATE INDEX IF NOT EXISTS idx_prr_audit_request     ON password_reset_audit_log (request_id);

-- ── 3. Permissions (RLS off — custom-auth model, mirrors notifications) ─────
ALTER TABLE password_reset_requests   DISABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_audit_log  DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_reset_requests, password_reset_audit_log FROM anon, authenticated;
-- Only the SECURITY DEFINER functions touch these tables directly.

-- ── 4. Realtime (so admin queue updates live) ───────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE password_reset_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 5. Helper: is the caller an active Admin? ───────────────────────────────
CREATE OR REPLACE FUNCTION _is_active_admin(p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = p_user_id
      AND role::TEXT = 'Admin'
      AND COALESCE(is_active, TRUE) = TRUE
  );
$$;

-- ── 6. Submit request (public — must NOT reveal account existence) ──────────
-- Always returns NULL. Callers must show the same generic message regardless.
-- Behaviour:
--   • Trim + lowercase the username, cap length.
--   • If username doesn't map to an active user: log 'UnknownUser' audit
--     row and return silently.
--   • If a Pending/In Progress request already exists for the user, or a
--     resolved request within the cooldown window: log 'DuplicateBlocked'
--     and return silently.
--   • Otherwise insert the row, log 'Created', notify all active Admins.
CREATE FUNCTION submit_password_reset_request(
  p_username   TEXT,
  p_source_ip  TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username        TEXT;
  v_user            RECORD;
  v_cooldown_minutes INT := 30;   -- configurable cooldown window
  v_recent          RECORD;
  v_request_id      UUID;
  v_notified        INT;
BEGIN
  -- ── Sanitize input ────────────────────────────────────────────────────────
  IF p_username IS NULL THEN RETURN; END IF;
  v_username := lower(trim(p_username));
  IF v_username = '' OR length(v_username) > 100 THEN
    INSERT INTO password_reset_audit_log
      (attempted_username, action, notes, source_ip, user_agent)
    VALUES (left(coalesce(p_username,''),100), 'InvalidInput',
            'Empty or oversized username', p_source_ip, p_user_agent);
    RETURN;
  END IF;
  -- Reject anything that looks like injection / control chars
  IF v_username ~ '[[:cntrl:]]' OR v_username ~ '[;''"\\]' THEN
    INSERT INTO password_reset_audit_log
      (attempted_username, action, notes, source_ip, user_agent)
    VALUES (left(v_username,100), 'InvalidInput',
            'Disallowed characters in username', p_source_ip, p_user_agent);
    RETURN;
  END IF;

  -- ── Look up user (never leak the result to the caller) ───────────────────
  SELECT user_id, username, name, is_active
    INTO v_user
    FROM users
   WHERE lower(username) = v_username
   LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_user.is_active, TRUE) THEN
    INSERT INTO password_reset_audit_log
      (attempted_username, action, notes, source_ip, user_agent)
    VALUES (v_username,
            CASE WHEN NOT FOUND THEN 'UnknownUser' ELSE 'InactiveUser' END,
            'No eligible account for reset',
            p_source_ip, p_user_agent);
    RETURN;
  END IF;

  -- ── De-dupe: existing open request? ──────────────────────────────────────
  SELECT request_id, status, created_at
    INTO v_recent
    FROM password_reset_requests
   WHERE user_id = v_user.user_id
     AND status IN ('Pending','In Progress')
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    INSERT INTO password_reset_audit_log
      (request_id, subject_user_id, attempted_username, action, notes, source_ip, user_agent)
    VALUES (v_recent.request_id, v_user.user_id, v_username, 'DuplicateBlocked',
            'Existing ' || v_recent.status || ' request already open',
            p_source_ip, p_user_agent);
    RETURN;
  END IF;

  -- ── De-dupe: recently resolved request (cooldown window) ─────────────────
  SELECT request_id, status, created_at
    INTO v_recent
    FROM password_reset_requests
   WHERE user_id = v_user.user_id
     AND created_at > NOW() - (v_cooldown_minutes || ' minutes')::interval
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    INSERT INTO password_reset_audit_log
      (request_id, subject_user_id, attempted_username, action, notes, source_ip, user_agent)
    VALUES (v_recent.request_id, v_user.user_id, v_username, 'CooldownBlocked',
            'Within ' || v_cooldown_minutes || '-minute cooldown',
            p_source_ip, p_user_agent);
    RETURN;
  END IF;

  -- ── Create the request ───────────────────────────────────────────────────
  INSERT INTO password_reset_requests
    (user_id, requested_username, status, source_ip, user_agent)
  VALUES
    (v_user.user_id, v_username, 'Pending', p_source_ip, p_user_agent)
  RETURNING request_id INTO v_request_id;

  INSERT INTO password_reset_audit_log
    (request_id, subject_user_id, attempted_username, action, notes, source_ip, user_agent)
  VALUES (v_request_id, v_user.user_id, v_username, 'Created',
          'Password reset request created', p_source_ip, p_user_agent);

  -- ── Notify every active Admin ────────────────────────────────────────────
  v_notified := notify_by_roles(
    ARRAY['Admin'],
    'password_reset',
    'Password Reset Requested',
    v_user.name || ' (' || v_user.username || ') has requested a password reset at '
      || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"') || '.',
    '/password-reset-requests',
    jsonb_build_object(
      'open_id',            v_request_id,
      'request_id',         v_request_id,
      'requesting_user_id', v_user.user_id,
      'requesting_username', v_user.username,
      'requested_at',       NOW()
    )
  );

  INSERT INTO password_reset_audit_log
    (request_id, subject_user_id, attempted_username, action, notes)
  VALUES (v_request_id, v_user.user_id, v_username, 'AdminsNotified',
          'Notified ' || v_notified || ' admin(s)');

EXCEPTION WHEN OTHERS THEN
  -- Never surface internal errors to the anonymous caller
  RAISE WARNING '[submit_password_reset_request] err=%', SQLERRM;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_password_reset_request(TEXT, TEXT, TEXT)
  TO anon, authenticated;

-- ── 7. Admin: list requests ─────────────────────────────────────────────────
CREATE FUNCTION admin_list_password_reset_requests(
  p_admin_user_id  TEXT,
  p_include_resolved BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  request_id         UUID,
  user_id            TEXT,
  requesting_user    TEXT,
  requesting_name    TEXT,
  requesting_role    TEXT,
  requested_username TEXT,
  status             TEXT,
  processed_by       TEXT,
  processed_by_name  TEXT,
  processed_at       TIMESTAMPTZ,
  reject_reason      TEXT,
  created_at         TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _is_active_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.request_id,
         r.user_id,
         u.username,
         u.name,
         u.role::TEXT,
         r.requested_username,
         r.status,
         r.processed_by,
         a.name,
         r.processed_at,
         r.reject_reason,
         r.created_at
  FROM   password_reset_requests r
  JOIN   users u ON u.user_id = r.user_id
  LEFT   JOIN users a ON a.user_id = r.processed_by
  WHERE  p_include_resolved OR r.status IN ('Pending','In Progress')
  ORDER  BY
    CASE r.status WHEN 'Pending' THEN 0
                  WHEN 'In Progress' THEN 1
                  WHEN 'Completed' THEN 2
                  WHEN 'Rejected'  THEN 3
                  ELSE 4 END,
    r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_password_reset_requests(TEXT, BOOLEAN)
  TO anon, authenticated;

-- ── 8. Admin: get single request ────────────────────────────────────────────
CREATE FUNCTION admin_get_password_reset_request(
  p_admin_user_id TEXT,
  p_request_id    UUID
) RETURNS TABLE (
  request_id         UUID,
  user_id            TEXT,
  requesting_user    TEXT,
  requesting_name    TEXT,
  requesting_email   TEXT,
  requesting_role    TEXT,
  requested_username TEXT,
  status             TEXT,
  processed_by       TEXT,
  processed_by_name  TEXT,
  processed_at       TIMESTAMPTZ,
  reject_reason      TEXT,
  source_ip          TEXT,
  user_agent         TEXT,
  created_at         TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _is_active_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.request_id, r.user_id,
         u.username, u.name, u.email, u.role::TEXT,
         r.requested_username, r.status,
         r.processed_by, a.name,
         r.processed_at, r.reject_reason,
         r.source_ip, r.user_agent, r.created_at
  FROM   password_reset_requests r
  JOIN   users u ON u.user_id = r.user_id
  LEFT   JOIN users a ON a.user_id = r.processed_by
  WHERE  r.request_id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_password_reset_request(TEXT, UUID)
  TO anon, authenticated;

-- ── 9. Admin: mark In Progress ──────────────────────────────────────────────
CREATE FUNCTION admin_start_password_reset_request(
  p_admin_user_id TEXT,
  p_request_id    UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current TEXT;
BEGIN
  IF NOT _is_active_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_current FROM password_reset_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_current NOT IN ('Pending','In Progress') THEN
    RAISE EXCEPTION 'Request already resolved' USING ERRCODE = '55000';
  END IF;

  UPDATE password_reset_requests
     SET status       = 'In Progress',
         processed_by = p_admin_user_id
   WHERE request_id   = p_request_id;

  INSERT INTO password_reset_audit_log (request_id, actor_user_id, action, notes)
  VALUES (p_request_id, p_admin_user_id, 'Started', 'Admin claimed the request');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_start_password_reset_request(TEXT, UUID)
  TO anon, authenticated;

-- ── 10. Admin: mark Completed ───────────────────────────────────────────────
-- Called AFTER the admin has manually reset the user's password via the
-- existing set_user_password RPC. Removes the request from the pending list.
CREATE FUNCTION admin_complete_password_reset_request(
  p_admin_user_id TEXT,
  p_request_id    UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF NOT _is_active_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM password_reset_requests
   WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status NOT IN ('Pending','In Progress') THEN
    RAISE EXCEPTION 'Request already resolved' USING ERRCODE = '55000';
  END IF;

  UPDATE password_reset_requests
     SET status       = 'Completed',
         processed_by = p_admin_user_id,
         processed_at = NOW()
   WHERE request_id   = p_request_id;

  INSERT INTO password_reset_audit_log (request_id, actor_user_id, subject_user_id, action, notes)
  VALUES (p_request_id, p_admin_user_id, v_row.user_id, 'Completed',
          'Password reset performed by admin');

  -- Notify the requesting user
  PERFORM notify_user(
    v_row.user_id,
    'password_reset',
    'Password Reset Completed',
    'Your password has been reset by an administrator. Please sign in with your new password.',
    '/login',
    jsonb_build_object('request_id', v_row.request_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_complete_password_reset_request(TEXT, UUID)
  TO anon, authenticated;

-- ── 11. Admin: reject request ───────────────────────────────────────────────
CREATE FUNCTION admin_reject_password_reset_request(
  p_admin_user_id TEXT,
  p_request_id    UUID,
  p_reason        TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row RECORD; v_reason TEXT;
BEGIN
  IF NOT _is_active_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
  END IF;

  SELECT * INTO v_row FROM password_reset_requests
   WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status NOT IN ('Pending','In Progress') THEN
    RAISE EXCEPTION 'Request already resolved' USING ERRCODE = '55000';
  END IF;

  UPDATE password_reset_requests
     SET status       = 'Rejected',
         processed_by = p_admin_user_id,
         processed_at = NOW(),
         reject_reason = v_reason
   WHERE request_id   = p_request_id;

  INSERT INTO password_reset_audit_log (request_id, actor_user_id, subject_user_id, action, notes)
  VALUES (p_request_id, p_admin_user_id, v_row.user_id, 'Rejected',
          COALESCE(v_reason, 'No reason provided'));
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reject_password_reset_request(TEXT, UUID, TEXT)
  TO anon, authenticated;

-- ── 12. Sanity notice ───────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ Password Reset Requests — Setup Complete ══';
  RAISE NOTICE '  Table       : password_reset_requests';
  RAISE NOTICE '  Audit log   : password_reset_audit_log';
  RAISE NOTICE '  RPCs        : submit_password_reset_request,';
  RAISE NOTICE '                admin_list/get/start/complete/reject_password_reset_request';
  RAISE NOTICE '  Cooldown    : 30 minutes (edit constant in submit_password_reset_request)';
  RAISE NOTICE '══════════════════════════════════════════════';
END $$;
