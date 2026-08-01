# JTC Ops ERP — Handoff Notes

> No previous `handoff.md` existed in the repository. This file was
> initialised alongside the **Forgot Password → Admin-managed reset**
> workstream. Extend the sections below rather than adding new top-level
> sections, per the project's documentation convention.

## Overview

The ERP now supports an Admin-managed password reset workflow, replacing
the previous self-service *Change Password* link on the login page. Users
never learn whether their username exists; every request funnels into the
ERP notification queue for the Admin role, and the Admin resets the
password manually via the existing user-management RPC.

## Brand & Theme

- **JTC brand rollout — Tailwind config**
  (`frontend/tailwind.config.js`)
  - The canonical `primary` colour scale is now anchored on the official
    JTC brand red **#EE1C25**. The full ladder is
    `50 #FEF2F2`, `100 #FEE2E2`, `500 #EE1C25` (solid buttons, active
    states), `600 #CA181F` (hover), `700 #A5141A` (active/pressed),
    `900 #5C0A0F` (deep accent). Every existing `bg-primary-*`,
    `text-primary-*`, `ring-primary-*`, `border-primary-*` and
    `focus:ring-primary-*` class in the codebase automatically adopts
    the brand red without further per-page edits — so the sidebar's
    active nav highlight/indicator, `.btn-primary` buttons, `.input`
    focus rings, avatar chips, and mobile-nav active tab are all
    rebranded centrally.
  - The pre-existing `jtc` colour token (`DEFAULT #EE1C25`,
    `dark #CA181F`) is retained for the login page's `ring-jtc` /
    `ring-jtc-dark` utilities and now points at the same brand values
    as the primary scale.
  - A new **`dispatch`** colour scale preserves the pre-rebrand blue
    palette (`500 #3b5bdb`, hover `600 #364fc7`, active `700 #2f44ad`,
    surface `50 #f0f4ff`, etc.). This palette is used **only** by the
    Dispatch module so its visual identity remains bit-exact identical
    to the previous primary-blue implementation — see the DispatchManage
    section below. Do not use `dispatch-*` classes outside the Dispatch
    module.

- **Shared component tokens**
  (`frontend/src/index.css`)
  - `.btn-primary` now maps to the JTC red ladder — `bg-primary-500`,
    hover `bg-primary-600`, active `bg-primary-700`, with disabled
    styling (`opacity-60`, `cursor-not-allowed`, hover suppressed) so
    every "Save / Create / Submit / Update / Confirm / Add New" button
    in the app becomes a branded action without touching page code.
  - A parallel `.btn-dispatch` class is introduced that mirrors the
    old blue `.btn-primary` behaviour using the new `dispatch-*` scale.
    It is used exclusively inside the Dispatch module (see below).
  - Aurora glass-card shadow tint variables
    (`--aurora-shadow`, `--aurora-shadow-hover`, `--aurora-shadow-sm`,
    and the `.neo-inset` inset shadow) switched from indigo
    `rgba(99, 102, 241, ...)` to a low-alpha JTC red
    `rgba(238, 28, 37, ...)`. Alphas remain intentionally low (0.06 –
    0.14) so raised glass surfaces read as *branded but premium* rather
    than washed red. The decorative multi-colour body aurora backdrop
    (purple / cyan / pink / indigo / teal) is intentionally left
    untouched — it is a neutral decorative background, not a blue
    accent, and the requirements explicitly preserve neutral
    backgrounds.
  - `.btn-secondary`, `.card`, `.input` layout / spacing / border /
    radius / typography are all unchanged; only the focus-ring colour
    of `.input` changes (via the new `primary-500`).

- **Semantic status colours preserved**
  (`frontend/src/components/common/StatusBadge.jsx`,
   `frontend/src/components/notifications/NotificationBell.jsx`)
  - Status-meaningful colours are **not** rebranded. The blue swatches
    on `Operations Review`, `Dispatched`, `Assigned`, `Sent`, `Normal`
    priority, the indigo `Quoted` badge, the dispatch-type notification
    icon colour, and all green (success) / amber (warning) / red-as-
    -error / gray-as-neutral mappings are left alone so their
    information content survives the rebrand intact. Only accent-role
    blues (interactive active states, brand chrome) were replaced.

- **StatCard default tile → brand**
  (`frontend/src/components/common/StatCard.jsx`)
  - `COLOR_MAP` gains a new `primary` entry
    (`bg-primary-50 text-primary-600`) and the component's default
    `color` prop switches from `'blue'` to `'primary'`. Dashboard KPI
    tiles that don't specify a colour now render in JTC red — matching
    the "generic accent → brand red" rule — while tiles that explicitly
    request `color="blue"` (or any other semantic colour) still resolve
    to that literal palette. No dashboard file needs editing.

- **Inline hex swaps**
  (`frontend/src/pages/admin/AuditLogs.jsx`)
  - The audit-log date/select controls' inline focus outline switched
    from indigo `#6366f1` to JTC red `#EE1C25` so their focus state
    matches the rest of the app's `focus:ring-primary-500`.

- **Dispatch module — visually preserved**
  (`frontend/src/pages/dispatch/DispatchManagePage.jsx`)
  - Per the requirements, the Dispatch module's colours and styling are
    left **exactly** as they were pre-rebrand. To make this possible
    while the global `primary-*` scale flipped to red, the 27
    `primary-{shade}` class references and the 6 `btn-primary`
    references inside `DispatchManagePage.jsx` were mechanically
    renamed to `dispatch-{shade}` and `btn-dispatch` — a text-level
    rename only, no logic / layout / spacing / animation change. The
    new `dispatch` Tailwind scale holds the identical hex values the
    old `primary` scale used, and `.btn-dispatch` mirrors the previous
    `.btn-primary` blue behaviour, so the rendered pixels for every
    Dispatch screen are byte-for-byte identical to before this
    rebrand. All other Dispatch files (`DispatchDetail.jsx`,
    `DispatchForm.jsx`, `DispatchList.jsx`, `DriverAssignment.jsx`,
    `DispatchDashboardPage.jsx`) already used non-`primary` colours
    (hardcoded blues / indigos scoped to their own components) and are
    intentionally not touched.

## Cleanup & Vercel Readiness

- **Pre-deploy cleanup pass** — a conservative, verification-first sweep
  was performed before the Vercel deploy to eliminate provably dead code
  and unreferenced assets. Every removal below was gated on a full-tree
  Grep confirming **zero** references outside the definition site.
  Anything with ambiguous ownership, dynamic references, or a plausible
  future use was intentionally left alone (per the project's
  "when in doubt, keep" guardrail). The Dispatch module, loading
  animation, sidebar hover animation, login page, routing, authentication,
  and branding assets were treated as read-only for this pass.

- **Removed files** (zero remaining references anywhere in `frontend/`
  including `public/index.html` and `public/manifest.json`):
  - `frontend/src/components/common/DataTable.jsx` — empty placeholder
    (0 bytes) never imported.
  - `frontend/src/components/common/Pagination.jsx` — empty placeholder
    (0 bytes) never imported.
  - `frontend/src/components/common/SearchFilter.jsx` — empty placeholder
    (0 bytes) never imported.
  - `frontend/public/file.svg` — Create-React-App scaffold leftover,
    not linked from `index.html`, `manifest.json`, or any component.
  - `frontend/public/logo-JTC.png` — legacy raster logo. The application
    exclusively uses the SVG variants in `public/logo/` (verified by
    grepping every `logo-JTC` occurrence — none exist). The PWA icons
    `logo192.png` and `logo512.png` are still referenced by
    `manifest.json` / `index.html` and were kept.

- **Removed dead code**
  - `frontend/src/pages/procurement/ProcurementPage.jsx` — deleted the
    commented-out `PROC_STATUSES` constant (line 29). It was retained
    as a `//` comment from an earlier refactor and referenced nowhere.
    The active `TABS`, `EMPTY_ITEM` and `PROC_TABLES` constants above /
    below it are untouched.
  - `frontend/src/pages/auth/Login.jsx` — deleted a commented-out
    `<h1>JTC Ops Portal</h1>` remnant from the pre-brand layout (the
    `<p>` subtitle immediately beneath it continues to render). The
    file's header comment was also refreshed to describe the current
    persistent-instance / retirement-only static-logo reveal, replacing
    the stale note that said the static logo shows the moment
    `dock.revealed` flips. Zero runtime effect; pure noise removal.
    All imports, state, refs, callbacks and effects in `Login.jsx`,
    `AppLoadingGate.jsx` and `LogoDockContext.js` were spot-verified as
    referenced — nothing else in the three files touched this session
    qualifies as unused.
  - `frontend/src/context/PermissionsContext.jsx` — removed the unused
    `permissionsSource` field from the provider value (a full-tree
    Grep confirms zero consumers), and wrapped the provider value in
    `useMemo` so every `usePermissions()` consumer
    (`Sidebar`/`MobileNav`/`ProtectedRoute` and every page that reads
    permissions) only re-renders when the semantic value actually
    changes. Previously the provider handed out a fresh object literal
    on every render of `PermissionsProvider` itself — triggering a
    cascade of no-op consumer re-renders on any internal state flip
    (`rolePerms` / `moduleMap` / `overrides` / `moduleOverrides` /
    `source`). The memo dependencies are the exact `useCallback`
    references and primitives the value carries, so === identity is
    correct and safe. Same pattern as the `LogoDockContext` memo
    already used by `AppLoadingGate`. Pure re-render reduction; no
    functional change.
  - Follow-up audit after the User Permissions section, Super Admin
    immunity fix, and server-side password-reset authorization landed:
    every state / ref / callback / import in the files touched by those
    changes was re-verified as referenced (12 lucide-react imports in
    `UserManagement.jsx` all used; every `useMemo` hook consumed in
    render; every new admin-API export has ≥1 consumer; every RPC
    local variable declared in the two new SQL migrations is used).
    No new dead code was introduced by any of those changes — nothing
    to remove. ESLint clean on the three runtime files
    (`PermissionsContext.jsx`, `api/admin.js`, `UserManagement.jsx`).

- **Assets and imports kept intentionally**
  - `frontend/public/logo/*.svg` (dot, J-body, T-stem, T-bar, C, wedge,
    flag-top, flag-bottom, `jtc-full-logo`, `truck-initial`) are all
    referenced by `JTCLogoAnimation.jsx`, `SidebarLogoHover.jsx`, and
    `Login.jsx`, so they are preserved without exception — they drive
    the loading animation, sidebar hover replay, and login brand mark.
  - All lucide-react icon imports across page components were
    spot-verified with per-file identifier counts (Procurement, Finance
    Invoices, Quotation Form, Equipment, User Management, Maintenance
    Jobs) — every named icon import is referenced ≥ 1× in JSX. No
    tree-shakable dead icons were found.
  - Shared dashboard components (`Charts`, `KPICards`, `RecentActivity`)
    are imported by all 8 role dashboards; shared common components
    (`StatusBadge`, `StatCard`, `EmptyState`, `Skeleton`,
    `LoadingSpinner`, `ConfirmDialog`, `Modal`, `ErrorBoundary`,
    `ProtectedRoute`, `Layout`, `Navbar`, `Sidebar`, `MobileNav`,
    `SidebarLogoHover`) are all referenced and preserved.
  - The `React` default import in files that still declare it is kept
    even where the JSX transform makes it optional — removing it risks
    a runtime error under the classic-runtime build configuration and
    the reward (a few bytes) doesn't justify the deploy risk.

- **Vercel bundle impact**
  - Three zero-byte source files removed → three fewer entries in the
    module graph. Two unused static assets removed from `public/` →
    both are shipped as-is by Vercel's static handler, so their
    removal is a direct static-payload reduction (roughly 6 KB for the
    PNG).
  - No runtime allocations, effects, or component initialization paths
    were altered — the runtime behaviour of every screen (including
    Dispatch, Login, dashboards, forms, tables and filters) is
    unchanged.
  - No new warnings or errors were introduced: the only source-file
    edit deletes a comment line, and the removed common-component
    files had no consumers to break.

## Auth & Access

- **Sidebar branding** (`frontend/src/components/common/Sidebar.jsx`,
  `frontend/src/components/common/SidebarLogoHover.jsx`)
  - The placeholder *KW* icon and *"KW Ops Portal"* text have been
    removed from the sidebar header. The header now renders **only**
    the official JTC logo (`/logo/jtc-full-logo.svg`) — the same
    asset used by the login page and the loading-screen animation —
    perfectly centred both horizontally and vertically inside the
    `h-16 px-4` header. At rest, the mark is scaled to `w-24 h-auto`
    (expanded) / fit-to-width with `max-h-6` (collapsed), keyed off
    the intrinsic `aspect-ratio: 427 / 138` so it never stretches,
    crops, or shifts as the SVG paints. No user title/role is
    rendered next to or beneath the logo. Sidebar width, spacing
    outside the header, nav items, icons, the user-profile section
    at the bottom, the collapse/expand behaviour, and routing are
    all untouched.
  - **Hover animation.** Hovering the sidebar logo plays a
    scaled-down replay of the loading-page assembly sequence, driven
    by `SidebarLogoHover.jsx`. The component renders the same
    canonical eight-piece decomposition of `jtc-full-logo.svg` used
    by `JTCLogoAnimation.jsx` (dot, J-body, T-stem, T-bar, C, wedge,
    flag-top, flag-bottom) and reuses every timing constant, per-
    group release delay, cubic-bezier easing curve and motion
    variant of the loading page — nothing is re-tuned or
    approximated. The phase machine
    `idle → wedgeLeft → letters → flourish → idle` runs as follows:
    on hover the assembled logo snap-cuts to wedge-only; the wedge
    smoothly translates from its logo slot on the right to the exact
    centre of the sidebar header (`wedgeLeft`, ~260 ms, ease-in-out);
    it then translates back rightward to its rest slot (`letters`,
    ~700 ms, linear) and *during that rightward return* the three
    letter groups (J + dot, T, C) emerge sequentially from wherever
    the wedge is at each group's release moment, using the loading
    page's exact `PLACE_DUR_S` glide, per-group delays and easing;
    finally the dot performs the identical projectile-toss + bounce
    `flourish` onto its perch above the J. The wedge's return uses
    linear easing so a small helper (`wedgeOffsetAtReleaseCanvas`)
    computes the wedge's exact canvas offset at each release — so
    letters genuinely emerge from *inside* the moving wedge rather
    than from a static origin. Debounce is structural: `mouseenter`
    is only accepted while `phase === 'idle'`, making overlapping,
    interrupted, or duplicated runs impossible. `useReducedMotion`
    short-circuits to the plain SVG for users who prefer no motion.
    Pieces are absolute-positioned as percentages of the header
    container so the sequence scales identically in expanded and
    collapsed sidebar states, uses GPU-accelerated transforms via
    framer-motion, and never mounts or unmounts SVGs — nothing is
    reflowed or re-fetched between plays.
  - **Red-dot alignment fix.** The dot's native x in the canonical
    piece decomposition has been nudged 0.55 canvas-units left
    (40.3008 → 39.75) in both `JTCLogoAnimation.jsx` and
    `SidebarLogoHover.jsx` so the dot's centre sits exactly on the
    J stem's centreline (stem visible edges at canvas x = 43 and
    x = 77.5 → centre 60.25 = dot centre). No animation timing,
    easing, motion path or SVG asset is otherwise touched. The
    `SidebarLogoHover.jsx` `beside-J` staging offsets
    (`DOT_ASIDE_OX_CANVAS`, `DOT_ASIDE_OY_CANVAS`) are now derived
    from the same closed-form of the loading page's `rOx / rOy`
    (`−1.6·dot.w − dot.x`, `LOGO_H − dot.h − dot.y`), so the
    flourish arc starts from the same offset the loading page uses
    and lands exactly on the freshly-centred perch.
  - **Navigation loading indicator.** In addition to hover, the same
    `SidebarLogoHover` sequence now doubles as a lightweight page-
    navigation loading indicator so users get consistent visual
    feedback while destination pages render their skeleton loaders.
    `SidebarLogoHover.jsx` accepts an optional `trigger` prop (a
    monotonically-incremented counter); a new effect watches it and
    calls the same `startAnimation()` path that hover uses, so the
    exact same phase machine, timings, easing, and SVG assets are
    replayed — no second animation, no duplicated assets, no
    separate motion component. `Sidebar.jsx` subscribes to
    `useLocation()` and bumps the trigger on every `pathname` change
    (using a counter rather than the pathname itself so a
    back-navigation to the current path still counts, and using a
    ref-guarded initial-mount skip so the sidebar does not replay
    while the login-page → dashboard hand-off is still underway).
    Rapid consecutive sidebar clicks are debounced structurally by
    the pre-existing `phase !== "idle"` guard inside `startAnimation`
    — a mid-flight animation cannot be restarted or overlapped, so a
    user who clicks Requirements → Quotations → Invoices in quick
    succession sees a single, uninterrupted replay rather than
    interleaved fragments. The animation ends naturally on its own
    timeline (~1.3s combined wedge sweep + letter emerge + dot
    flourish), i.e. the loading indicator "stops automatically" once
    the sequence completes; whether the destination page's skeleton
    loader is still visible at that instant, has just handed off to
    real content, or resolved earlier is orthogonal — the skeleton
    implementation itself is untouched. Reduced-motion users still
    short-circuit to the flat SVG via `useReducedMotion` (unchanged),
    and MobileNav does not render `SidebarLogoHover` so the mobile
    layout is unaffected.

- **Loading animation gating**
  (`frontend/src/components/loading/AppLoadingGate.jsx`)
  - The truck-delivery welcome animation now follows a **two-rule
    gate**, evaluated once, lazily, inside the gate's initial
    `useState`:
    1. **First load in this tab** (session flag
       `sessionStorage["jtc_loading_played"]` not yet set):
       PLAY, regardless of the initial URL. This preserves the original
       app-boot behaviour end-to-end — a fresh tab landing on `/login`,
       on `/dashboard` via a valid session cookie, or on any deep
       link all still get the welcome animation on that first paint.
    2. **Subsequent load in this tab** (session flag already set,
       i.e. the animation has already played once here — so this load
       is a refresh or a hard navigation, not a fresh tab):
       PLAY only when `window.location.pathname === "/login"`
       (a login-page refresh); SKIP for every other path
       (`/dashboard`, `/procurement`, any admin route, etc.).
  - The pathname check is read synchronously against `window.location`
    *before* `BrowserRouter` has processed anything, so it reflects the
    real HTTP load target — not the current client-side route, which
    could not otherwise distinguish a refresh at `/dashboard` from a
    soft in-app navigation to `/dashboard`.
  - Client-side pushes within the same tab (Sign Out → `/login`, an
    expired session bounced through `ProtectedRoute` → `/login`, an
    in-app link into an admin page, etc.) **never** re-arm the
    animation, because the gate is mounted exactly once above the
    router in `src/index.js` and re-evaluates nothing after that
    initial mount. On a skip, the gate returns `children` directly,
    without mounting the `<LogoDockContext.Provider>`, the full-screen
    overlay, the `JTCLogoAnimation` component, its asset preloading,
    or any of the hard-timeout / reduced-motion fallback timers — no
    flicker, no briefly-visible loading screen, and no wasted work on
    the hot path.
  - The persistence write happens **only** at the two natural completion
    points of the sequence (`handleDocked` after a successful dock,
    `fallbackFinish` for the no-dock / error / hard-timeout /
    reduced-motion paths) — so an animation that is aborted mid-way (e.g.
    tab closed before it lands) will replay on the next attempt, but any
    completed run — including the fail-open fallback — is treated as
    "seen" for the rest of the tab's lifetime. Closing the tab / window
    ends the session and lets the animation play again on the next fresh
    visit, exactly as `sessionStorage` semantics prescribe.
  - On subsequent visits, `LogoDockContext` is intentionally **not**
    provided; the login page's existing `dock === null` branch then
    renders its static JTC logo and the rest of the UI immediately with
    no dock-signal wait, matching the "login page appears immediately"
    requirement without touching `Login.jsx`. All animation assets,
    timings, easing, transitions, responsiveness, and the login page
    itself are unchanged.
  - **Persistent single-instance logo hand-off (flicker fix).** The
    JTC logo the user watches from the first loading frame through the
    entire docked login screen is now a **single, continuously mounted
    element**: the same 8-piece `motion.img` assembly inside the
    overlay. During the dock glide it moves via a pure `transform`
    (translate + scale) on its outer `motion.div` wrapper — no element
    is remounted, recreated or replaced mid-flight, no opacity is
    reset, no SVG is redrawn, no layout shifts (the overlay is
    `position: fixed` and never participates in the page's layout).
    When the glide lands, `handleDocked` performs **no DOM mutation on
    the logo at all**: the overlay stays mounted with the assembled
    pieces exactly where they landed, the login page's own static
    `<img>` stays hidden (`opacity: 0`), and only the login UI cascade
    (heading / card / link / footer) reveals beneath the parked logo
    after the existing 180ms `UI_REVEAL_DELAY_MS`. There is nothing to
    swap at the landing instant, therefore nothing that can flicker.
  - The overlay is only **retired** (its parked animated logo removed
    in the same React commit as the login's static `<img>` becoming
    opaque — batched by React, so a single paint) at moments where
    that one swap frame physically cannot be seen:
    (a) the login page unmounting after a successful sign-in (the
    dashboard is rendering over the whole viewport in the same commit,
    so no user's eye is on the logo box);
    (b) a `resize` / `orientationchange` / `scroll` (capturing) event —
    layout changes the `position: fixed` overlay logo could not track
    anyway, whose own reflow / scroll repaint masks the swap frame.
    Retirement is signalled to the login page via a new `logoVisible`
    flag on `LogoDockContext`, kept deliberately separate from
    `revealed` (which now only gates the login UI cascade, not the
    static logo's opacity). The gate also fires an off-thread
    `HTMLImageElement.decode()` on the hidden `<img>` the moment the
    dock lands, so the eventual retirement paint has a decoded bitmap
    on hand and cannot flash blank.
  - The login page's `useEffect` that registers the slot now depends
    only on the gate's **stable `registerSlot` callback reference**,
    not the whole context object — so `revealed` / `logoVisible` flips
    can never churn an unregister/re-register cycle here. That makes
    the slot unregister a reliable "login is unmounting" signal, which
    the gate uses (with a one-microtask defer, to survive StrictMode
    double-invoke) as its retirement trigger for the sign-in path.
  - Overlay stacking after dock: while the animation plays, the
    overlay carries the maximum possible `z-index` (`2147483647`) so
    nothing can paint over the delivery; the instant the dock lands it
    drops to `z-index: 10`, above the page content but **below** the
    login's own dialog / toast surfaces (the Forgot Password modal
    renders at `z-50`), so a modal opened on the docked-but-not-yet-
    retired login screen still layers correctly. A z-index change
    alone repaints no pixels, so this cannot flicker either.
  - All failure paths remain fail-open and are updated in lockstep:
    the error boundary, the 15s hard timeout, the reduced-motion
    grace, and the no-slot fallback all still route through
    `fallbackFinish`, which now also sets `logoVisible = true` (as
    well as `revealed = true`) so a login screen that never docks is
    never left without its own static logo. `POST_DOCK_MS` has been
    fully removed. Loading animation, logo assembly animation, dock
    timing / easing, and login layout are untouched.

- **Login page** (`frontend/src/pages/auth/Login.jsx`)
  - The pre-auth *Change Password* link has been replaced by a **Forgot
    Password?** link. Layout, JTC branding, logo dock reveal, loading
    animation, responsiveness and existing input styling are unchanged.
  - The link opens a two-step dialog: (1) a confirmation asking *“Would
    you like to submit a password reset request to the system
    administrator?”*, (2) a generic completion message
    *“If your account is eligible, your password reset request has been
    submitted to an administrator.”* — shown regardless of whether the
    username exists, is inactive, is duplicate, or fails validation.
  - The removed self-service `ChangePasswordModal` is gone entirely; the
    on-login *Change Password* affordance no longer exists.

- **AuthContext** (`frontend/src/context/AuthContext.jsx`)
  - `adminResetPassword(userId, newPassword)` (existing RPC
    `set_user_password`) is still the sole mechanism Admins use to set
    a user's password. The new workflow reuses it after opening a reset
    request; no new client-side password mutation path was introduced.
  - `changePassword` remains for authenticated users to change their own
    password from inside the app but is no longer exposed on the login
    screen.

- **RBAC** (`frontend/src/lib/rolePermissions.js`,
  `frontend/src/context/PermissionsContext.jsx`,
  `frontend/add_super_admin_rbac.sql`,
  `frontend/add_user_module_overrides.sql`,
  `frontend/fix_password_reset_authorization.sql`)
  - `Admin` role gains the `password-reset-requests` nav key and the
    `password_reset_admin` permission. No other role can list, view,
    complete, or reject password reset requests. The permission is
    re-checked server-side on every RPC.
  - **Super Admin role added, plus a DB-backed permission layer on top
    of the above.** `ROLES.SUPER_ADMIN` sits above `Admin` with
    unconditional access everywhere (`fn_is_super_admin` on the DB
    side; a `role === 'Super Admin'` bypass in `hasPermission`/
    `canAccess`/`PermissionsContext`). **Immunity to Roles &
    Permissions edits is complete on both sides.** The role×module
    grid excludes `Super Admin` from `EDITABLE_ROLES`;
    `admin_set_role_permission` raises when `p_role = 'Super Admin'`;
    `admin_set_user_module_override` refuses `Super Admin` targets and
    actor-on-self writes; `ProtectedRoute` already skips maintenance
    mode for Super Admin; and `canAccessModule` now short-circuits to
    true for Super Admin **before** consulting `isModuleEnabled`, so a
    Super Admin disabling a module system-wide can never hide the
    toggle (or any other module) from themselves. Together these
    close every Roles-&-Permissions path that could have removed the
    Super Admin's own access to the tool they use to manage the
    permission model. The original static
    `ROLE_NAV`/`PERMISSIONS` matrix in `rolePermissions.js` is
    **untouched and still runs** — the new `PermissionsContext`
    (three tables: `role_permissions`, `modules`,
    `user_permission_overrides`) is **ANDed on top** of each page's
    existing fine-grained check (`canWrite = hasPermission(role,
    'x_create') && canEdit('module')`), never replacing it, so a
    Super Admin can live-*restrict* a role/module but a bad DB row can
    never grant more than the static matrix already allowed.
    `ProtectedRoute`/`Sidebar`/`MobileNav` (which had only the coarse
    `canAccess` check, nothing fine-grained to preserve) are a full
    replacement — this also fixed a real pre-existing bug where
    `ProtectedRoute`'s `navKey` prop was accepted but never read, so
    every route was reachable by direct URL regardless of role.
  - **"Reset Password" is now individually grantable**, off for every
    Admin by default (`user_permission_overrides`, `permission_key =
    'password_reset'`) — the Super Admin grants/revokes it per-Admin
    from the new Roles & Permissions page. Gates both the
    `PasswordResetRequests` page's render and its sidebar/mobile-nav
    visibility.
  - **Per-user module overrides** (new — extends the RBAC layer without
    replacing any of it). New table `user_module_overrides
    (user_id, module_key, can_view, can_edit)` in
    `frontend/add_user_module_overrides.sql`, plus two new
    Super-Admin-only `SECURITY DEFINER` RPCs:
    `admin_set_user_module_override` (upsert; view=false coerces
    edit=false at the storage layer) and
    `admin_clear_user_module_override` (delete the row → "inherit from
    role"). Both audit-log every change. The set RPC refuses to write
    for the actor's own account or against a `Super Admin` target
    (Super Admin's access is unconditional, so a row would be a silent
    no-op — failing loud is clearer). `PermissionsContext`'s `canView` /
    `canEdit` now evaluate in strict order **Super Admin → user
    override → role permission → default deny**, exactly matching the
    hierarchy in the product requirement. `user_module_overrides` was
    added to `REALTIME_TABLES`, so a change made in the Super Admin's
    User Management dialog reaches the affected user's active session
    within the same debounce window as any role-level change — no
    logout required. UI addition: a new *User Permissions* collapsible
    section inside the existing Edit User dialog
    (`UserManagement.jsx`), Super Admin only, hidden for `Super Admin`
    targets. It shows each module's role default alongside the
    effective (post-override) value, with a "reset to role default"
    action per row that DELETEs the override row. Rings around a toggle
    indicate an active override so **Role Permissions** and **User
    Overrides** are distinguishable at a glance. The RPCs' Super Admin
    gate + the target-role refuse-if-`Super Admin` guard together
    prevent any privilege-escalation path: a regular Admin cannot see
    the section, cannot call the RPCs, and even a Super Admin cannot
    grant a peer more than themselves (there is no "more than Super
    Admin"). Fetch failures on `user_module_overrides` fall back
    cleanly — role permissions still load and evaluate — so a fresh
    environment without the migration behaves exactly like before.
  - **Real-time, no logout.** `PermissionsContext` subscribes (the
    existing `useRealtimeRefresh` hook) to all three permission
    tables plus `users`; a Super Admin's change reaches every open
    session within the hook's debounce window. It also watches the
    signed-in user's own `users.is_active` and calls `logout()`
    immediately if it flips to `false` — real-time credential
    revocation.
  - **Server-enforced, not client-trusted.** Every privileged mutation
    (`admin_set_user_role`, `admin_set_user_active`,
    `admin_reset_user_password`, `admin_create_user`,
    `admin_set_role_permission`, `admin_set_module_enabled`,
    `admin_grant_user_permission`) is a `SECURITY DEFINER` RPC that
    re-verifies the actor's role fresh from `users` — see
    `frontend/src/api/admin.js`. `UserManagement.jsx`'s role/
    active-status edits were moved off the old plain `updateUser()`
    table write (which had no privilege check at all) onto these
    RPCs. A regular Admin can never act on another Admin or a Super
    Admin (`fn_can_manage_target`), closing the privilege-escalation
    gap.
  - **Server-side password-reset authorization — closed** (previously
    the "known gap, not yet closed" bullet). The 5 password-reset RPCs
    (`admin_list_password_reset_requests`,
    `admin_get_password_reset_request`,
    `admin_start_password_reset_request`,
    `admin_complete_password_reset_request`,
    `admin_reject_password_reset_request`) all gate internally on
    `_is_active_admin(p_admin_user_id)`, which previously checked only
    `role = 'Admin' AND is_active` — meaning a Super Admin (role
    `'Super Admin'`, not `'Admin'`) could not call any of them, and
    any active Admin could call them regardless of the fine-grained
    `password_reset` grant in `user_permission_overrides`.
    `frontend/fix_password_reset_authorization.sql` redefines
    `_is_active_admin` in place to delegate to `fn_can_reset_passwords`
    (Super Admin unconditional, plus Admin-with-grant). The function
    name is preserved deliberately so none of the 5 RPC bodies needs
    to be rewritten — their `IF NOT _is_active_admin(...)` calls
    inherit the new semantics on the next call. The header comment on
    the redefine explicitly notes the widened intent
    ("was 'is this an active Admin', is now 'is this user authorized
    to process password reset requests'") so a future reader who
    greps the name understands why. The same migration also
    strengthens `admin_grant_user_permission` to refuse Super Admin
    targets and actor-on-self — matching the immunity discipline used
    by `admin_set_user_module_override` and
    `admin_set_role_permission`, so the "Super Admin's password_reset
    cannot be revoked, even by another Super Admin" property is now
    enforced at the write layer, not just at evaluation time. Real-
    time revocation was already in place via
    `PermissionsContext.REALTIME_TABLES`; combined with this
    server-side fix, a Super Admin revoking a grant now takes effect
    on the affected Admin's screen (sidebar, route, page render) **and**
    on their subsequent RPC calls within the realtime debounce window.
    No client change was needed.
  - **Live role refresh.** `PermissionsContext`'s existing watch on
    the signed-in user's own `users` row now also compares `role` (not
    just `is_active`) — if a Super Admin changes this user's own role
    while they're signed in, `AuthContext.updateProfileRole()` patches
    `profile.role` in place and `DashboardRouter` immediately renders
    the correct dashboard for the new role, with no logout/re-login
    step. Satisfies "the dashboard must update immediately after
    re-authentication or permission refresh" without adding a second
    place that mutates the session profile.
  - **Maintenance mode.** A single additional row in the existing
    `modules` table (`system_maintenance`, off by default, distinct
    from the pre-existing `maintenance` equipment-maintenance business
    module so the two can never be confused) toggled from the Super
    Admin Dashboard. `ProtectedRoute` blocks every route for every
    non-Super-Admin while it's on, via a full-page "System under
    maintenance" screen. No new table or RPC — reuses
    `admin_set_module_enabled` and the same realtime subscription
    already in place.
  - **Bug found and fixed the same day**: before the `system_maintenance`
    row had actually been inserted in a given database, every non-
    Super-Admin was incorrectly locked out with the maintenance screen,
    even though nobody had turned it on. Root cause: the check reused
    `isModuleEnabled()`, whose `?? true` fallback is the *correct* safe
    default for ordinary nav modules (missing row → don't hide it) but
    is exactly backwards for this one flag (missing row → must read as
    "off", not "on"). Fixed by adding a dedicated
    `isMaintenanceModeOn` in `PermissionsContext` — a strict
    `moduleMap?.get('system_maintenance') === true`, which is only ever
    true for a real, present, explicit `true` value. `ProtectedRoute`
    now checks that instead. Do not route this check back through
    `isModuleEnabled()` or anything else with an enabled-by-default
    fallback.

## Notifications

- **Type & routing** (`frontend/src/components/notifications/NotificationBell.jsx`,
  `frontend/src/context/NotificationContext.jsx`)
  - New notification `type: 'password_reset'` with a red key-round icon.
  - `link: '/password-reset-requests'`; `metadata.open_id` is the
    `request_id`, which the bell already forwards as
    `state.openId` on navigation.
- **Delivery** — internal only. **No** email, SMS, OTP, or external
  channel is triggered. Delivery is via the existing polling + realtime
  `notifications` pipeline, addressed to every active user with
  `role = 'Admin'`.
- On completion the requesting user receives a notification confirming an
  admin has reset their password. On rejection nothing is sent to the
  requester (audit only).

## Admin Console

- **New page** (`frontend/src/pages/admin/PasswordResetRequests.jsx`,
  route `/password-reset-requests`, sidebar entry *“Password Resets”*).
  - Lists Pending → In Progress → resolved requests; a
    *Include resolved* toggle exposes history.
  - Detail modal supports:
    - **Mark In Progress** — claims the request without resolving it.
    - **Reset Password & Complete** — inline form that calls the
      existing `adminResetPassword` RPC, then
      `admin_complete_password_reset_request`. On success the request
      leaves the pending queue.
    - **Reject** — captures an optional reason (max 500 chars) and
      records `Rejected` in the audit log.
  - Non-Admin users see an *Admin access required* placeholder; the page
    also gates every action through server-enforced RBAC.

- **New page** (`frontend/src/pages/admin/PermissionsManagement.jsx`,
  route `/permissions`, sidebar entry *"Roles & Permissions"*,
  Super-Admin-only).
  - Module enable/disable toggles, a role × module view/edit
    permission grid, and a per-Admin "Reset Password" grant list — all
    write through the RPCs in `frontend/src/api/admin.js`, never a
    direct table write. Realtime-refreshed like every other admin
    page.
- **`UserManagement.jsx`** gained: a Super-Admin-only *New User*
  button/form (`admin_create_user` — internally reuses
  `set_user_password` rather than reimplementing hashing), role
  promotion up to Admin/Super Admin (Super-Admin-only; the Role
  `<select>` is disabled for non-Super-Admins), and the *Active*
  checkbox now routes through `admin_set_user_active` instead of the
  old plain table write. The password-reset section is hidden
  entirely unless `canResetPasswords` is true for the signed-in user.
- **`AuditLogs.jsx`** gained a second tab, *Admin Actions*, alongside
  the existing *Session Logs* tab (page heading generalised from
  "Session Logs" to "Audit Logs" to match) — reads the `audit_logs`
  table (see below), realtime-refreshed the same way.
- **`SuperAdminDashboard.jsx`** (dedicated "System Administration"
  dashboard, wired into `DashboardRouter.jsx` for the `Super Admin`
  role only — `AdminDashboard.jsx` and the other 9 role dashboards
  are completely untouched; the two are never shared code). Expanded
  from the original version to cover every requested overview metric:
  total/active users, distinct role count, pending password-reset
  requests (`admin_list_password_reset_requests`), a best-effort
  pending-approvals count (independent, individually-caught counts
  across `requirements`/`quotations` pending-ish statuses — never
  blocks the rest of the page if a count query fails), active
  sessions, a System Health tile (green "Operational" unless any
  data source failed to load, in which case "Degraded" — computed
  client-side from actual fetch outcomes, not a fabricated metric),
  module enabled/total, and a permission-grants/role-rules summary.
  Below the stats: the existing users-by-role chart and recent-
  admin-actions feed, a read-only module-status chip list, and a
  **Quick access** grid (User Management, Role & Permission
  Management, Module Management, Password Reset Requests, Audit
  Logs — all navigate to their existing pages; "Module Management"
  and "Role & Permission Management" both point at `/permissions`
  since one page already covers both; "System Settings" shows a
  "coming soon" toast rather than linking to a page that doesn't
  exist) plus a **Maintenance Mode** toggle (see Backend/Database and
  Security sections below) that's a live action, not just a link.
  Every data source is fetched independently with its own
  catch-and-degrade, so one failing query never blanks the page.
- **Super Admin dashboard switcher** (`DashboardRouter.jsx` only —
  neither dashboard component was touched). A Super Admin is
  typically still an operational user, so replacing their whole
  dashboard with the System Administration one meant constant
  switching back and forth to check sales/dispatch/etc. `/dashboard`
  now gives the `Super Admin` role a small tab switch — **System
  Dashboard** | **Operations Dashboard** — right above the dashboard
  content, instead of picking one or the other. "Operations
  Dashboard" re-renders the existing `AdminDashboard.jsx` unchanged
  (the broadest existing operational overview, since Super Admin has
  no dedicated operational dashboard of its own). Every other role's
  dashboard selection is completely unaffected. The choice persists
  for the current browser session (`sessionStorage`, same convention
  as every other session-scoped flag in the app) so navigating away
  and back keeps the last-picked view, but a fresh session always
  lands on the System Dashboard by default, per spec.

## Backend / Database

- **Migration** — `frontend/password_reset_requests.sql` (apply once in
  the Supabase SQL editor).
- **Tables**
  - `password_reset_requests` — `request_id`, `user_id`,
    `requested_username`, `status`, `processed_by`, `processed_at`,
    `reject_reason`, `source_ip`, `user_agent`, `created_at`.
    A partial unique index enforces at most one open request per user.
  - `password_reset_audit_log` — immutable log of every event
    (`Created`, `AdminsNotified`, `Started`, `Completed`, `Rejected`,
    `UnknownUser`, `InactiveUser`, `DuplicateBlocked`, `CooldownBlocked`,
    `InvalidInput`). Includes actor, subject, timestamps, IP, UA and
    notes.
- **RPCs** (all `SECURITY DEFINER`; RLS is intentionally off — the
  codebase's custom-auth model means `auth.uid()` is always NULL):
  - `submit_password_reset_request(p_username, p_source_ip, p_user_agent)`
    — public. Always succeeds silently; the client cannot distinguish
    success from failure. Sanitises the username, blocks duplicates and
    a 30-minute cooldown, and notifies every active Admin on a real
    creation.
  - `admin_list_password_reset_requests(p_admin_user_id, p_include_resolved)`
  - `admin_get_password_reset_request(p_admin_user_id, p_request_id)`
  - `admin_start_password_reset_request(p_admin_user_id, p_request_id)`
  - `admin_complete_password_reset_request(p_admin_user_id, p_request_id)`
  - `admin_reject_password_reset_request(p_admin_user_id, p_request_id, p_reason)`
  - All admin RPCs re-validate the caller is an active `Admin` via
    `_is_active_admin(p_user_id)` before doing any work; unauthorised
    calls raise `42501`.

- **Migration** — `frontend/add_super_admin_rbac.sql` (apply once in
  the Supabase SQL editor; safe to re-run).
- **New enum value** — `user_role` gains `'Super Admin'` (its own
  top-level statement; Postgres requires a new enum value to commit
  before it can be referenced elsewhere in the same script).
- **Tables** (RLS off, `SELECT`-only grants to `anon`/`authenticated`
  — same reasoning as every other table in this custom-auth codebase:
  `auth.uid()` is always NULL, so RLS policies can't be keyed off it;
  the RPCs below are the only write path):
  - `role_permissions` — `(role, module_key)` → `can_view`,
    `can_edit`. Seeded to reproduce the pre-existing `ROLE_NAV`/
    `PERMISSIONS` matrix exactly, so the migration changes nothing on
    its own. No rows for `Super Admin` (its access is an unconditional
    bypass, not a lookup).
  - `modules` — `module_key` → `label`, `is_enabled`. Seeded with
    every existing nav key, all enabled, plus one non-nav row,
    `system_maintenance` (system-wide maintenance-mode lockout),
    seeded `is_enabled = false` — the one deliberate exception to
    "everything defaults on."
  - `user_permission_overrides` — `(user_id, permission_key)` →
    `granted`. Used today for `permission_key = 'password_reset'`.
- **RPCs** (all `SECURITY DEFINER`, all re-verify the actor's role
  fresh from `users` — never trust a client-passed role):
  `fn_is_super_admin`, `fn_can_reset_passwords`,
  `fn_can_manage_target` (privilege-ceiling check), `admin_set_user_role`,
  `admin_set_user_active`, `admin_reset_user_password`
  (calls the existing `set_user_password` internally),
  `admin_create_user` (same), `admin_set_role_permission`,
  `admin_set_module_enabled`, `admin_grant_user_permission`. Every
  successful call writes an `audit_logs` row via `fn_log_admin_action`
  (`ROLE_CHANGE`, `USER_ACTIVATED`/`USER_DEACTIVATED`, `USER_CREATED`,
  `PASSWORD_RESET`, `PERMISSION_CHANGE`, `MODULE_TOGGLE`,
  `PERMISSION_GRANT`) — the pre-existing `audit_logs` table (previously
  only written to once, from `api/dispatch.js`) is now the backing
  store for the Admin Actions tab above.

## Security Requirements — How They Are Met

- **No account enumeration.** `submit_password_reset_request` returns
  `VOID` and swallows every error path. The UI always renders the same
  generic confirmation. Unknown / inactive users are logged only in the
  audit table.
- **Input validation.** Client trims and strips control chars, caps at
  100 chars; server re-trims, lowercases, rejects control chars and
  disallowed punctuation, caps at 100 chars.
- **Duplicate + cooldown.** A partial unique index and an explicit
  `Pending`/`In Progress` check prevent concurrent duplicates. A
  30-minute cooldown after the most recent request is enforced in the
  RPC (edit the constant at the top of `submit_password_reset_request`
  to change it).
- **Audit trail.** Every request creation, admin action, rejected
  submission, and duplicate/cooldown attempt is written to
  `password_reset_audit_log` with the actor user id, subject, timestamp,
  source IP and user agent.
- **RBAC on every operation.** Admin listing/inspection/mutation RPCs
  gate on `_is_active_admin(p_admin_user_id)` before touching data.
  Non-admins receive `42501` with no data leak.
- **Backend-authoritative.** All state transitions run inside the
  `SECURITY DEFINER` RPCs. The frontend only issues intents; it holds
  no shared secrets and cannot bypass the checks.
- **Internal-only delivery.** Notifications are dispatched exclusively
  through `notify_by_roles(...,'Admin',...)` — no email, SMS, OTP, or
  external service is invoked.
- **Super Admin RBAC follows the same principles**: every write to
  role/permission/module/user state goes through a `SECURITY DEFINER`
  RPC that re-checks the actor server-side (never the client-passed
  role); a privilege ceiling (`fn_can_manage_target`) stops a regular
  Admin from ever touching another Admin or a Super Admin; every
  action is written to `audit_logs`; the three new permission tables
  grant `SELECT` only, so a compromised or malicious client can read
  its own effective permissions but cannot write any of them directly.
  One gap remains open and is tracked, not silently left unmentioned:
  the 5 pre-existing password-reset-request RPCs still gate on a
  blanket `_is_active_admin` check rather than the new granular
  permission (see Auth & Access → RBAC above).

## Not Changed

Login page layout, JTC branding, logo animation, authentication flow,
form input styling, mobile responsiveness. The self-service Change
Password functionality on the pre-auth page is intentionally removed —
users must now go through the admin-managed workflow.

## How to Deploy

1. Apply `frontend/password_reset_requests.sql` in Supabase.
2. Deploy the frontend (no environment variables were added).
3. Verify a non-admin user can raise a request and receives the generic
   confirmation.
4. Verify all Admin users receive an in-app notification, open it, reset
   the password, and see the request disappear from the queue.
5. Verify a second request from the same user within 30 minutes shows
   the same generic confirmation but no new admin notification.
