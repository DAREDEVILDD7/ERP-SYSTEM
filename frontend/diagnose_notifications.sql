-- ═══════════════════════════════════════════════════════════════════════
-- Notification Diagnostics — run this FIRST in Supabase SQL Editor
-- Read the output to understand why notifications aren't working.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Check whether triggers exist on each table
SELECT
  trigger_name,
  event_object_table  AS "table",
  action_timing,
  event_manipulation  AS "event"
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'tg_%_notify'
ORDER BY event_object_table;

-- 2. Check whether helper functions exist (and their exact signatures)
SELECT
  p.proname                          AS "function",
  pg_get_function_arguments(p.oid)   AS "args",
  pg_get_function_result(p.oid)      AS "returns"
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('notify_by_roles','notify_user')
ORDER BY p.proname, p.oid;

-- 3. Check RLS status and grants on the notifications table
SELECT
  t.tablename,
  t.rowsecurity                       AS "rls_enabled",
  string_agg(a.privilege_type, ', ') AS "granted_to_anon"
FROM pg_tables t
LEFT JOIN information_schema.role_table_grants a
  ON a.table_name = t.tablename AND a.grantee = 'anon'
WHERE t.tablename = 'notifications'
GROUP BY t.tablename, t.rowsecurity;

-- 4. Check user roles (to verify the trigger role strings match exactly)
SELECT
  role,
  COUNT(*)                                                         AS total_users,
  COUNT(*) FILTER (WHERE COALESCE(is_active, TRUE) = TRUE)        AS active_users
FROM users
GROUP BY role
ORDER BY role;

-- 5. Direct test: call notify_by_roles and check if a row appears
DO $$
DECLARE v INT;
BEGIN
  v := notify_by_roles(
    ARRAY['Admin'],
    'system',
    'Diagnostic Test',
    'If you see this notification it means the function works correctly.',
    NULL,
    '{}'
  );
  RAISE NOTICE 'notify_by_roles sent to % user(s)', v;
  IF v = 0 THEN
    RAISE WARNING 'notify_by_roles sent 0 notifications — role name may not match. Check step 4 output.';
  END IF;
END $$;

-- 6. Recent notifications in the DB
SELECT
  notification_id,
  user_id,
  type,
  title,
  created_at
FROM notifications
ORDER BY created_at DESC
LIMIT 15;
