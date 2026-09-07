# JTC Ops ERP — Handoff

Current state and work in flight. Extend the existing sections
rather than adding new top-level sections. Reference detail is in
`docs/`; how-to-work-here rules are in `CLAUDE.md`; history is in
git.

## Overview

JTC Ops is a single-page ERP for JTC (fleet / dispatch / rentals /
procurement / finance / maintenance). Frontend is Create-React-App
in `frontend/`; backend is Supabase (RPCs + tables), migrations in
`frontend/*.sql`. Custom auth (session in `sessionStorage`, no
Supabase Auth). Deployed on Vercel with the `create-react-app`
framework preset and Root Directory `frontend`.

## Overall status

- Production-shaped; recent shipped work in order: Vercel readiness
  pass; Super Admin RBAC + per-user module overrides; Admin-managed
  password-reset workflow; Analytics assistant (13 sections, brief,
  loader); Neomorphism 3D dashboard theme (all 9 role dashboards).
- **`87a6a7e` (doc restructure) has NOT been pushed.** Branch is 1
  commit ahead of `origin/master`. Push when ready.
- No active migration or deploy blocker at the time of writing.
- Finance module is **UI-only** and awaiting stakeholder answers on
  `docs/Finance-Requirements-Discovery.md`.

## Current task

None declared. The working tree carries uncommitted analytics work
(see below) that reads as an iteration on the previously shipped
analytics-assistant workstream.

## Recently completed (latest local commit `87a6a7e`, not yet pushed)

- **Fixed two caveats in the Priority Signals data-quality path
  (uncommitted).** (1) A newly created quotation could reach page 1001+
  of `getTopCustomers`'s 365-day window and be silently invisible to the
  ribbon: PostgREST caps an unbounded select at 1000 rows with no error —
  measured directly against the live database — and `quotations` was
  within 20 rows of that cliff; `quotation_items` had already crossed it.
  Fixed with `safeQueryAll` / `PK_COLUMN` in `api/analytics.js`, applied to
  `windowedRows` (covers `invoices`/`quotations`/`lease_invoices`) and to
  every raw `quotation_items` query that could plausibly cross 1000 rows
  (`getMostRentedEquipment`, `getMaintenanceFrequency`,
  `getRevenueByCategory` ×2, `getUnitPnL`). (2) `top_customers` had a
  30-minute stale time with no realtime subscription, so a quote created
  live during a demo would not reach the ribbon for up to half an hour;
  `quotations` was already in the Supabase realtime publication, so
  `top_customers` now carries `realtime: ['quotations']`
  (`hooks/useAnalytics.js`), mirroring the existing `idle_vs_active`
  pattern. New `scripts/verify_row_pagination.mjs` (16 assertions) proves
  both against a fake Supabase client holding >1000 rows with the
  triggering rows placed deliberately in the truncated tail.

- **Analytics: a Priority Signal chip now explains itself (uncommitted).**
  Clicking a chip used to open the section named by the rule's `promptId`,
  and eight of the fifteen rules name `top_customers` — so clicking
  "2 anomalous quotes detected" asked "who are our top customers by
  billing?". Every rule in `lib/anomalyRules.js` now carries an `explain`
  block (what it detects, why it fired, how it is measured, the rows
  responsible, what to do, related sections), rendered into the chat by the
  new `components/analytics/SignalDetail.jsx`. The related section survives
  as a follow-up chip. Evidence rows for the four data-quality rules come
  from `breakdowns.dataQualityFlags`, which `getTopCustomers` already ships,
  so no new query was added. Verified by `scripts/verify_signal_detail.cjs`
  (79 jsdom checks) and a new section in `verify_analytics_signals.mjs`
  (now 218 assertions, was 56).

- **The POC seed's lease UPDATEs did not reach the database.** All five
  insert blocks landed (626/867/867/403/331 confirmed against live
  Supabase) but `equipment_units` carried zero seeded leases, so the
  Forward forecast read KWD 0 on all three horizons with no error anywhere.
  The lease block is the last thing in the file, after the inserts. Added
  `frontend/seed_poc_leases_2026.sql` (standalone, re-runnable) and a
  verification `SELECT` at the end of the generated seed so a short paste
  cannot fail silently again.

- **Analytics: Priority Signals + Forward forecast (uncommitted, for the
  Sunday POC).** The forecasting and anomaly-detection work for the POC
  lives on the **Analytics page**, not the dashboard. Four record-level
  data-quality rules added to `lib/anomalyRules.js` (KWD 0, missing,
  negative, duplicate/oversized), fed by `screenQuotations()` run inside
  `getTopCustomers` over quotations it already fetches — no new query.
  `getForwardForecast` was already correct but had no data: only 3 units
  held leases and all ended Aug 2026, so every horizon read KWD 0. The
  seed adds 24 lease commitments to `equipment_units`, producing
  30d 44,619 / 60d 76,959 / 90d 101,458 KWD with a deliberate renewal
  cliff. Verified by `scripts/verify_analytics_signals.mjs` (56
  assertions).

- **Operational Dashboard (uncommitted, additive — NOT part of the
  original POC ask).** Built before the scope was clarified; the ask was
  only for the tab *swap*. It works and is tested, but can be reverted to
  the plain `AdminDashboard` by changing one line in `DashboardRouter.jsx`
  if it is not wanted. New Super Admin landing view
  showing Quotes → Orders → Dispatch → Delivery → Returns as daily
  series, a 30/60/90-day forecast drawn past the last actual day, and
  record-level anomalies (KWD 0 quotes first). Tab order in
  `pages/DashboardRouter.jsx` is now Operational, then System, with
  Operational as the default; System Dashboard and every other role's
  routing are unchanged. New files: `src/components/dashboard/
  OperationalDashboard.jsx`, `src/api/operations.js`,
  `src/lib/forecast.js`, `src/lib/operationalAnomalies.js`,
  `scripts/pocDataset.js`, `scripts/generate_poc_seed.js`,
  `scripts/verify_operational_model.mjs`,
  `seed_poc_operations_2026.sql`, `docs/operational-dashboard.md`.
  **The seed has NOT been applied to Supabase** — run
  `frontend/seed_poc_operations_2026.sql` in the SQL editor before the
  demo. Detail and rationale: `docs/operational-dashboard.md`.

- **Doc restructure (`87a6a7e`).** Split the load-bearing reference
  out of the giant `CLAUDE.md` / `handoff.md` pair into
  `docs/architecture.md`, `docs/authorization.md`,
  `docs/deployment.md`, `docs/analytics.md`, `docs/branding.md`.
  `CLAUDE.md` holds persistent rules and pointers; this file
  describes current state only. One stale contradiction resolved:
  the password-reset RPC note about `role = 'Admin'` gating was
  closed by `fix_password_reset_authorization.sql` (verified present)
  via `_is_active_admin → fn_can_reset_passwords`.

- **Neomorphism 3D dashboard theme.** All 9 role-based dashboards
  converted to a neomorphism + 3D chart theme. Shared utilities live
  in `src/components/dashboard/DashUtils.jsx` (`Bar3D`, `DonutCentre`,
  `NEO_TOOLTIP_STYLE`, `PIE_FILTER_DEF`, `PIE_STYLE`). Tailwind
  `surface` token changed from `#f8f9fa` to `#e2e8f0` in
  `tailwind.config.js`. CSS classes (`neo-page`, `neo-card`,
  `neo-kpi`, `neo-inset`, `neo-flat`, `neo-row`, `neo-divider`)
  defined in `index.css`. Text color tokens updated from `text-gray-*`
  to `text-slate-*` throughout. Do not deviate from this pattern
  when adding new dashboards.

Older, still relevant:

- **Vercel readiness (`54ed343`).** Route-level code splitting via
  `lib/lazyRoute.js`, jspdf behind `lib/pdfGeneratorAsync.js`, 18
  unused deps removed, unreachable source files pruned,
  `vercel.json` created in `frontend/` (SPA rewrite + cache headers +
  security headers), `.env.production` with
  `GENERATE_SOURCEMAP=false`. Main bundle 637.55 kB → 217.63 kB
  gzipped. Chunk-load recovery guarded by
  `sessionStorage["jtc_chunk_reload"]`.
- **Super Admin RBAC.** New role above Admin with unconditional
  access. Migrations: `add_super_admin_rbac.sql` (roles/modules/
  permission-overrides tables, `SECURITY DEFINER` RPCs, seeded
  matrix, `system_maintenance` module),
  `add_user_module_overrides.sql` (per-user grants/denies + RPCs),
  `fix_password_reset_authorization.sql` (widens `_is_active_admin`
  to delegate to `fn_can_reset_passwords`, strengthens
  `admin_grant_user_permission`). See `docs/authorization.md`.
- **New admin pages.** `PermissionsManagement.jsx` (`/permissions`),
  `PasswordResetRequests.jsx` (`/password-reset-requests`),
  `SuperAdminDashboard.jsx` wired into `DashboardRouter.jsx` with a
  System / Operations tab switcher for Super Admins.
- **Admin-managed password reset workflow.** Public
  `submit_password_reset_request` RPC (silent success, cooldown,
  deduplication, audit log). Notifications routed to every active
  Admin. Admin RPCs for list / get / start / complete / reject.
- **Analytics assistant.** Analytics page with 13 sections powered by
  four layers (fetchers → templates → briefs → renderer), branded
  loader (JTC-capped Claude mascot sprite sheet), transcript scroll
  anchoring, streamed reply, date-range filter (7 presets +
  Custom + All time). See `docs/analytics.md`.
- **Branding rollout.** JTC red `#EE1C25` primary scale; Dispatch
  preserved on the `dispatch-*` scale byte-for-byte. See
  `docs/branding.md`.

## Currently being worked on

Uncommitted changes in the working tree:

- **Modified:** `frontend/src/api/analytics.js`,
  `frontend/src/components/analytics/sections.jsx`,
  `frontend/src/lib/insightTemplates.js`,
  `frontend/src/pages/analytics/AnalyticsPage.jsx`,
  `frontend/src/lib/rolePermissions.js`,
  `frontend/.gitignore`.
- **New (untracked):** `frontend/src/components/analytics/AnalysisBrief.jsx`,
  `frontend/src/components/analytics/DateRangeFilter.jsx`,
  `frontend/src/lib/analyticsLabels.js`,
  `frontend/src/lib/dateRange.js`,
  `frontend/src/lib/insightBrief.js`,
  `frontend/scripts/claude-mascot-src.svg`.
- These represent the analytics-assistant iteration described
  above; nothing is scheduled to be pushed at this moment. Confirm
  scope before committing.

## What remains unfinished

- **Finance module** — UI stubs only. Blueprint at
  `docs/Finance-Requirements-Discovery.md` awaiting stakeholder
  answers. Do not wire real APIs without explicit direction.
- **Analytics changes above** are uncommitted; no scope note has
  been left about what defines "done" for that iteration.

## Known issues / gaps

- No automated test runner is wired to CI for any area. Analytics
  verification is throwaway Node harnesses (see `docs/analytics.md`).
- `public/logo/truck-initial.svg` is 1.19 MB (base64 PNG in an SVG
  wrapper); shipping as WebP/AVIF is not free — needs a
  boot-animation sign-off. `framer-motion` (~135 kB) is unavoidably
  in the main bundle for the same reason.

## Important decisions to remember

- **The analytics loader was reverted 2026-08-07** to `54ed343`. A
  full day of animation work on top (single-drawing mascot, split
  laptop/impact-tick/ground layers, shared 7.8s timeline,
  strike-driven loading dots, per-keystroke laptop hop, upper-body
  sway) was **discarded in full at the user's instruction**. The
  four animation files are byte-identical to that commit and are
  the single source of truth. If a brief seems to ask for any of
  the discarded work, confirm before writing code — it was
  deliberately thrown away, not lost.
- The Dispatch module's visual identity is preserved exactly. Its
  classes were mechanically renamed from `primary-*` /
  `btn-primary` to `dispatch-*` / `btn-dispatch` during the JTC red
  rollout, with identical hex values. Rendered pixels are
  unchanged. Do not "clean this up" — the dispatch scale is the
  contract.
- `frontend/scripts/claude-mascot-src.svg` is UNUSED and untracked,
  and kept deliberately. It is the only copy of supplied artwork
  (single-drawing mascot supplied 2026-08-07) that briefly replaced
  the five-pose set. It costs nothing at runtime because it is in
  `scripts/`, not `public/`. Do not delete.

## Things NOT to attempt again without reconsideration

- **Do not "simplify" the login logo hand-off** by swapping to the
  static image at `handleDocked` time. The atomic-retirement pattern
  is what fixed the landing flicker; the "simpler" version
  reintroduces the double-composited SVG flash.
- **Do not put comments in `vercel.json`** (not even `"//"` keys).
  Vercel rejects the config during validation, before the build
  starts, and there is no build log to inspect. Rationale belongs
  in `docs/deployment.md`.
- **Do not statically import `lib/pdfGenerator.js`** from a page.
  Regression is silent (main bundle re-welds jspdf onto that
  page's chunk).
- **Do not reintroduce a `valueOf` / `toString` / other
  `Object.prototype`-named prop or option** anywhere in analytics.
  The defaulted destructure silently resolves the prototype method
  and throws "Cannot convert undefined or null to object". Bit
  twice already.
- **Do not tighten `getProcurementVsLease`'s `hasData` back to a
  single counter**, and do not delete its three-source fallback
  ladder (window procurements → all-time procurements → synthesised
  from `equipment_units`). Each ladder tier answers a real
  deployment.
- **Do not "finish the job" by feeding a range to utilisation or
  idle-vs-active.** Their subtitles say they take no range because
  `equipment_units.status` holds only the current state. The
  as-of-date treatment idle-vs-active applies to a range is a
  duration reference, not a snapshot filter.
- **Do not collapse the analytics revenue "basis ladder"** into one
  query. The three-step invoiced → contracted → null ladder,
  disclosed in the subtitle, is what makes the section usable on a
  quoting-but-not-billing deployment.
- **Do not "tidy" the sprite-sheet frame order** from the authored
  sequence into 1-2-3-4-5. That reintroduces a 45px monotonic drift
  and a snap-back at the loop point.
- **Do not remove `.jtca-sprite`'s `max-width: none` rule.**
  Tailwind's preflight ships `img { max-width: 100% }` and, being a
  different property from `width`, is not overridden by `width:
  500%`. The regression is "~5 Claudes squashed side-by-side" —
  purely a CSS cascade bug, not a duplicated render.
- **Do not route the maintenance-mode check through
  `isModuleEnabled()`** (or anything else with an
  enabled-by-default fallback). That fallback locked out every
  non-Super-Admin when the `system_maintenance` row was absent.
  `isMaintenanceModeOn` is `moduleMap?.get('system_maintenance') === true`,
  strict.

## Files recently modified

Latest local commit `87a6a7e` (unpushed): created five files under
`docs/` and rewrote `handoff.md`. The commit before that (`54ed343`)
touched `vercel.json`. The work behind the older completed items
lives across the analytics tree, the auth/permissions tree, the
loading tree, and the SQL migration files listed in `docs/`.

Uncommitted working-tree changes (see "Currently being worked on"):
`frontend/src/api/analytics.js`, `sections.jsx`, `insightTemplates.js`,
`AnalyticsPage.jsx`, `rolePermissions.js`, `frontend/.gitignore`.
Also uncommitted, from the Operational Dashboard work:
`frontend/src/pages/DashboardRouter.jsx`, `CLAUDE.md`, plus the new
files listed under "Recently completed".
Untracked new files: `AnalysisBrief.jsx`, `DateRangeFilter.jsx`,
`analyticsLabels.js`, `dateRange.js`, `insightBrief.js`,
`scripts/claude-mascot-src.svg`.
From the priority-signal explainer work, also uncommitted:
`frontend/src/lib/anomalyRules.js`, `components/analytics/AnomalyRibbon.jsx`,
`pages/analytics/AnalyticsPage.jsx`, `docs/operational-dashboard.md`,
`CLAUDE.md`. New: `components/analytics/SignalDetail.jsx`,
`scripts/verify_signal_detail.cjs`, `frontend/seed_poc_leases_2026.sql`.
From the row-pagination fix, also uncommitted:
`frontend/src/api/analytics.js` (`safeQueryAll`, `PK_COLUMN`,
`windowedRows` rewritten, five `quotation_items` call sites converted),
`frontend/src/hooks/useAnalytics.js` (`top_customers` realtime). New:
`frontend/scripts/verify_row_pagination.mjs`, `docs/analytics.md`.

## Next steps

- **Apply `frontend/seed_poc_operations_2026.sql`** in the Supabase SQL
  editor before the POC. Until it runs: the live data ends 2026-08-19,
  the Forward forecast reads KWD 0 on all three horizons, and no
  data-quality Priority Signals fire.
- **Push `87a6a7e`** to origin/master when ready (doc restructure commit).
- Decide the scope for the uncommitted analytics iteration (which
  slices ship, which are still incubating) before committing.
- Await Finance stakeholder answers on
  `docs/Finance-Requirements-Discovery.md` before touching the
  Finance code beyond UI stubs.
- No other pending work is scheduled.

## How to deploy

1. Apply any new SQL migrations in `frontend/*.sql` via the Supabase
   SQL editor (safe to re-run; each header describes preconditions).
2. Push to `master`. Vercel deploys automatically from Root
   Directory `frontend`.
3. Verify: a non-admin user can raise a password-reset request and
   receives the generic confirmation; Admins receive the in-app
   notification and can complete the reset; the boot animation
   plays on a first tab visit and skips on subsequent hard loads to
   non-`/login` paths; the analytics page loads and answers a
   catalogue prompt end-to-end.
