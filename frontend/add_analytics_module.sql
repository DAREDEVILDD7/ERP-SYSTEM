-- ═══════════════════════════════════════════════════════════════════════════
-- Analytics module — seed
--
-- Adds the read-only Analytics page to the DB-backed permission matrix.
-- Follows the same pattern as add_super_admin_rbac.sql: one row in
-- modules, and one row per role in role_permissions. No new tables, no
-- new RPCs — the Analytics page runs entirely on the existing
-- aggregations against the operational tables.
--
-- Access defaults (aligned with docs/AI-Analytics-Design.md §8):
--   Admin              — view=true
--   Head of IT         — view=true
--   Finance Officer    — view=true
--   Operations Manager — view=true
--   Everyone else      — no row (default deny, same convention as the
--                        other privileged modules)
-- Super Admin has an unconditional bypass in PermissionsContext, so no
-- row is needed and none must be inserted (see the immunity contract in
-- CLAUDE.md).
--
-- can_edit is set to false everywhere: the page is read-only and no
-- mutation path is added by this module.
--
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO modules (module_key, label) VALUES
  ('analytics', 'Analytics')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO role_permissions (role, module_key, can_view, can_edit) VALUES
  ('Admin',              'analytics', true, false),
  ('Head of IT',         'analytics', true, false),
  ('Finance Officer',    'analytics', true, false),
  ('Operations Manager', 'analytics', true, false)
ON CONFLICT (role, module_key) DO NOTHING;
