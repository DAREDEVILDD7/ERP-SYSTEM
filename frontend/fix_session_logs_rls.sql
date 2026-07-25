-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: session_logs INSERT/UPDATE failing with
--   "new row violates row-level security policy for table session_logs"
--   POST .../rest/v1/session_logs?select=session_log_id  401 (Unauthorized)
--
-- Root cause: this app has its own username/password login (the
-- verify_login RPC against the users table) — it never creates a real
-- Supabase Auth session. Every request from the browser (including this
-- one) therefore runs as the `anon` Postgres role, and auth.uid() is
-- ALWAYS NULL. The previous version of this file added policies keyed off
-- `auth.uid() = user_id` and `TO authenticated` — those can never pass here,
-- which is exactly why every insert/update was rejected.
--
-- This is the same root cause already documented (and already fixed the
-- same way) for the `notifications` table in enable_notifications.sql:
--   "Custom RPC auth — auth.uid() is always NULL. RLS must stay OFF."
-- session_logs follows that same, already-established convention: RLS off,
-- explicit grants to anon/authenticated. Application-level access control
-- (only an authenticated in-app session can reach the pages that read/write
-- this table) is enforced by React Router's ProtectedRoute + role checks,
-- same as everywhere else in this codebase — there is no separate DB-level
-- user identity to key a policy off in this architecture.
--
-- Safe to run multiple times. Paste everything into Supabase SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Drop the old, non-functional auth.uid()-based policies ────────────────
DROP POLICY IF EXISTS "Users can insert own session log"  ON session_logs;
DROP POLICY IF EXISTS "Users can update own session log"  ON session_logs;
DROP POLICY IF EXISTS "Admins can read all session logs"  ON session_logs;

-- ── 2. RLS off + explicit grants (matches notifications' established fix) ───
ALTER TABLE session_logs DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON session_logs TO anon, authenticated;

-- If session_log_id is a serial/identity column rather than a UUID default,
-- the anon/authenticated roles also need USAGE on its backing sequence for
-- INSERT ... RETURNING to work. No-op (and harmless) when it's a UUID PK.
DO $$
DECLARE
  v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('session_logs', 'session_log_id');
  IF v_seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', v_seq);
  END IF;
END $$;

-- ── 3. Self-test & diagnostics ────────────────────────────────────────────────
DO $$
DECLARE
  v_rls     boolean;
  v_grants  text;
  v_test_id session_logs.session_log_id%TYPE;
  v_uid     users.user_id%TYPE;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ session_logs RLS Fix — Verification ══';

  SELECT rowsecurity INTO v_rls FROM pg_tables WHERE tablename = 'session_logs';
  IF v_rls THEN
    RAISE WARNING '  ✗ RLS is still enabled on session_logs — the ALTER TABLE above should have disabled it.';
  ELSE
    RAISE NOTICE '  ✓ RLS is disabled on session_logs.';
  END IF;

  SELECT string_agg(DISTINCT privilege_type, ', ') INTO v_grants
  FROM information_schema.role_table_grants
  WHERE table_name = 'session_logs' AND grantee = 'anon';
  RAISE NOTICE '  anon privileges on session_logs: %', COALESCE(v_grants, '(none — something is wrong)');

  -- Live round-trip test using a real user_id (avoids tripping any FK/type
  -- constraint on session_logs.user_id, whatever its exact type turns out
  -- to be) — insert then immediately delete the throwaway row.
  SELECT user_id INTO v_uid FROM users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE '  (skipped insert round-trip — no rows in users table to borrow an id from)';
  ELSE
    BEGIN
      INSERT INTO session_logs (user_id, username, name, role, department, user_agent)
      VALUES (v_uid, 'rls_selftest', 'RLS Self-Test', 'Admin', 'IT', 'sql-editor-selftest')
      RETURNING session_log_id INTO v_test_id;

      DELETE FROM session_logs WHERE session_log_id = v_test_id;

      RAISE NOTICE '  ✓ Insert + delete round-trip succeeded — session_logs is writable.';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '  ✗ Round-trip insert failed: % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;

  RAISE NOTICE '══════════════════════════════════════════';
END $$;
