# Architecture

High-level structure of the JTC Ops ERP frontend. Covers the app
composition tree, the loading-animation → login hand-off, the dashboard
router, and the neomorphism dashboard system.

## Repository layout

- `frontend/` — Create-React-App workspace (React 19, `react-scripts`
  5, Tailwind 3.4, framer-motion 12, react-router-dom 7, Supabase JS
  client). Single-page app; the whole ERP is served from here.
- `frontend/*.sql` — Supabase migrations, applied manually in the SQL
  editor.
- `frontend/public/logo/*.svg` — the 8 decomposed logo pieces (dot,
  j-body, t-stem, t-bar, c, wedge, flag-top, flag-bottom), plus
  `jtc-full-logo.svg` and `truck-initial.svg`. All are referenced by
  the loading animation, the sidebar hover replay, and the login page —
  none are safe to remove.
- `frontend/public/analytics/claude-jtc-typing.png` — the analytics
  loader sprite sheet. See `docs/analytics.md`.
- `frontend/scripts/build_claude_typing_sheet.py` — the sheet
  generator; do not run without reading the analytics doc first.
- `frontend/scripts/claude-mascot-src.svg` — unused build input,
  deliberately kept. It is a single-drawing mascot supplied 2026-08-07
  that briefly replaced the five-pose set. It is **untracked** — the
  only copy of supplied artwork lives here.
- `docs/` — reference docs (this file, authorization, deployment,
  analytics, branding, database-schema).
  `docs/Finance-Requirements-Discovery.md` is the Finance blueprint
  awaiting stakeholder answers.
- `handoff.md` — living hand-off notes describing current state and
  work in flight.

## Provider composition

`App.js` wraps everything in this order:

```
ErrorBoundary
  → BrowserRouter
    → QueryClientProvider
      → AuthProvider
        → PermissionsProvider
          → NotificationProvider
            → Routes
```

`/login` is public; every other route is inside `ProtectedRoute`,
which redirects to `/login` when there is no session. That redirect is
a **client-side navigation**, not a hard reload — the loading gate
does not re-fire on it.

`AppLoadingGate` is mounted **exactly once**, in `src/index.js`, above
`<BrowserRouter>`. Route changes never remount it. Anything that
needs to happen "on first paint" belongs here, not in a route
component.

## Auth session

Auth state lives in `AuthContext`. Login is via the `verify_login`
Supabase RPC; session is stored in `sessionStorage`. Supabase Auth is
deliberately disabled in the client — `autoRefreshToken`,
`persistSession`, `detectSessionInUrl` all `false`. There is no
`supabase.auth.*` call anywhere in `src`. If Supabase Auth is ever
adopted, all three go back to `true`.

Last-login logging and session logging are fire-and-forget. Do not
add awaits that block login on those.

## AppLoadingGate → Login logo hand-off

Files: `src/components/loading/AppLoadingGate.jsx`,
`src/components/loading/JTCLogoAnimation.jsx`,
`src/components/loading/LogoDockContext.js`,
`src/pages/auth/Login.jsx`.

### Single continuously-mounted logo instance

The truck-delivery animation is one continuously mounted logo
instance from the first loading frame through the entire docked-login
lifetime. It is 8 `motion.img` pieces inside a wrapper whose
`transform` is animated for the dock glide (translate + scale). During
the glide nothing is remounted, recreated, faded, opacity-reset, or
replaced.

The login page's own static `<img>` stays `opacity: 0` throughout the
visible docked-login lifetime. It only becomes opaque at
**retirement**, which happens **atomically in one React commit**
(`retireOverlay()` sets `logoVisible = true` and `visible = false`
together).

Retirement is deliberately scheduled only at moments where the one
swap frame is invisible:

- the login page unmounting after sign-in (detected via
  `registerSlot(null)`, microtask-deferred to survive StrictMode
  churn);
- a `resize` / `orientationchange` / capturing `scroll` event (whose
  own repaint masks the swap).

This is what fixed the landing flicker. Do not "simplify" it by
swapping to the static image at `handleDocked` time — that
reintroduces the double-composited SVG flash.

### LogoDockContext shape

`{ registerSlot, revealed, logoVisible }`.

- `revealed` gates the login page's UI cascade (heading / card / link
  / footer).
- `logoVisible` gates the login's static `<img>` opacity.
- Keep them separate.

The login page's slot-registration effect depends only on the
**stable `registerSlot` callback reference**, not the whole context
object — this is deliberate. Depending on the whole context makes
`revealed` / `logoVisible` flips churn the effect, which makes
slot-unregister an unreliable "page unmount" signal.

### Gating rules

Evaluated once, lazily, in `useState` at gate mount:

1. **First load in this tab** (session flag not set): PLAY the
   animation, regardless of the initial URL. Preserves the original
   app-boot experience for direct-to-`/dashboard` landings via a
   valid session cookie.
2. **Subsequent load in this tab** (session flag set — refresh or
   hard navigation): PLAY only when
   `window.location.pathname === "/login"`. Every other path skips the
   animation and returns `children` directly.

Client-side pushes (Sign Out, `ProtectedRoute` bounce) do **not**
remount the gate and cannot re-trigger the animation. The flag lives
in `sessionStorage["jtc_loading_played"]`.

The persistence write only happens at natural completion points
(`handleDocked`, `fallbackFinish`) — so an aborted animation replays
on the next attempt, but any completed run (including the fail-open
fallback) is treated as seen.

### Frozen internals

`JTCLogoAnimation.jsx` was ported byte-for-byte from an external
standalone project; the only integration-side additions are
`onComplete`, `dockRect`, `onDocked` props. Its timing constants,
easing curves, keyframes, asset paths, geometry freezing
(`frozenGeomRef`), and phase machine are **load-bearing and must not
be touched**. If a feature request seems to require it, push back and
check `handoff.md` first.

## Sidebar logo hover replay

`SidebarLogoHover.jsx` replays a scaled-down version of the loading
sequence on sidebar-logo hover. It reuses the canonical eight-piece
decomposition of `jtc-full-logo.svg` and every timing constant of the
loading page — nothing is re-tuned. Debounce is structural
(`phase !== 'idle'`), so overlapping runs are impossible.

The same component doubles as a page-navigation loading indicator via
a `trigger` prop bumped by `Sidebar.jsx` on every `pathname` change.
MobileNav does not render it.

## Neomorphism dashboards

All 9 role dashboards share a 3D neo theme. `DashUtils.jsx` exports
the shared utilities; Tailwind's `surface` colour was changed to
`#e2e8f0` for this theme. Any dashboard-adjacent change should pass
through `DashUtils.jsx` rather than re-implementing surface / shadow
styling per file.

## Dashboard router — Super Admin switcher

`pages/DashboardRouter.jsx` gives a Super Admin a tab switch
(`System Dashboard` | `Operations Dashboard`) at `/dashboard`, since a
Super Admin is usually still an operational user. "Operations
Dashboard" re-renders the existing `AdminDashboard` unchanged. Every
other role's branch of the `switch` is unaffected.

`SuperAdminDashboard.jsx` and `AdminDashboard.jsx` themselves are
distinct and never share code. Do not merge them.

The chosen view is stored in
`sessionStorage["jtc_super_admin_dashboard_view"]` so it survives
in-tab navigation but resets on a fresh session. System Dashboard is
the default on a fresh session, matching the requirement that the
default landing page after login is the System Administration
Dashboard.

The `useState` for the choice is declared unconditionally before the
`role` check, per Rules of Hooks — it is simply unused for other
roles.

## Notification poll

`NotificationContext` polls every 6s. To avoid re-rendering the whole
tree on every poll, `setNotifications(prev => sameNotifications(prev,
data) ? prev : data)` bails out when nothing changed. The comparison
is positional (`notification_id` + `is_read`), which is exact because
notification rows are insert/delete-only and `is_read` is the single
column any code path UPDATEs.

`AuthContext` and `NotificationContext` provider values are
`useMemo`-wrapped, same pattern as `PermissionsContext`. Both sit
above the whole tree; an inline literal handed every consumer a new
value on any render.
