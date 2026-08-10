# Deployment (Vercel)

Files: `frontend/vercel.json`, `frontend/.env.production`,
`frontend/src/App.js`, `frontend/src/components/common/Layout.jsx`,
`frontend/src/lib/pdfGeneratorAsync.js`,
`frontend/src/lib/lazyRoute.js`.

## Vercel project setup

- **Root Directory: `frontend`**. The repo root has no `package.json`
  at all. A `vercel.json` at the repo root is silently ignored under
  that setting.
- `vercel.json` deliberately does **not** override `buildCommand` /
  `installCommand` / `outputDirectory` — the `create-react-app`
  framework preset supplies those, and overriding one disables the
  preset's handling of the rest.

## vercel.json — no comments, ever

Vercel validates `vercel.json` against `openapi.vercel.sh/vercel.json`,
which sets `additionalProperties: false` at the top level *and* inside
every `headers[]` entry (only `source` / `headers` / `has` / `missing`
are allowed there). `$schema` is the one metadata key the schema
permits.

**This broke a deploy once.** A version of the file carried `"//"`
explanatory keys. Vercel rejected the config during validation —
**before the build starts**, so there was no build log and the deploy
simply never happened. Rationale for anything in that file belongs in
this doc or in `handoff.md`, never inline.

## Cache headers — split three ways on purpose

- `/static/*` — webpack-hashed, so `immutable` for a year.
- `/logo/*` and `/analytics/*` — **not hashed**. Referenced by literal
  path from `JTCLogoAnimation`, `SidebarLogoHover`, `Login`, and the
  Analytics loader. `max-age=86400` + `stale-while-revalidate`, never
  `immutable`: a regenerated sprite sheet or logo piece keeps its
  filename and `immutable` would pin the old bytes in every returning
  user's cache for a year.
- `/index.html` — `must-revalidate`. This is what points at the hashed
  bundles; cache it and a deploy never reaches anyone.

Also set: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` deny-list.

## Code splitting + chunk-load recovery

**Every routed page goes through `lib/lazyRoute.js`, not bare
`React.lazy`.** Code splitting introduces one production-only failure:
a deployed `index.html` names content-hashed chunks, a redeploy
changes those names, and anyone holding the old page who then
navigates to a route they have not visited gets a 404 →
`ChunkLoadError` → the ErrorBoundary eats the whole app.

`lazyRoute` retries the import once, then reloads the page exactly
once (guarded by `sessionStorage["jtc_chunk_reload"]`, cleared by the
next chunk that loads) so the tab picks up the current build, and
only then re-throws to the ErrorBoundary. This is why `/index.html`
must stay `must-revalidate` — the reload only helps if it fetches
fresh HTML.

Storage access is wrapped: if `sessionStorage` throws, the code
treats it as "already reloaded" and never reloads, because a reload
loop is worse than an error screen.

## Suspense boundary placement

`Login`, `Layout` and `ProtectedRoute` are the only eager route-level
modules.

- **Login is eager** because a chunk fetch inside the AppLoadingGate
  → Login logo hand-off would put a network round-trip in the middle
  of the docked-logo timing (see `docs/architecture.md`).
- **Layout is eager** so the single `<Suspense>` boundary can live
  *inside* `<main>`, around `<Outlet />`. A boundary above `<Routes>`
  would tear the sidebar and navbar down on every navigation.

If you add a route, add it lazily and it inherits that boundary. Do
not add a second `<Suspense>`.

## jspdf must never be static-imported

`lib/pdfGenerator.js` must never be imported statically from a page.
jspdf + jspdf-autotable are ~130 kB gzipped — the heaviest thing in
the app.

Import from `lib/pdfGeneratorAsync.js`, which wraps each exporter in
a deferred `import()` so the jspdf chunk is fetched on the first
Export click rather than on page load. The wrappers keep the same
signatures; every call site is a fire-and-forget `onClick`, so
returning a promise is invisible.

A static import anywhere re-welds jspdf onto that page's chunk and
the regression is silent.

## CI=true — every ESLint warning is a build error

Vercel sets `CI=true`, so `react-scripts build` fails the whole
deploy on a single unused import or variable, while the same warning
is silent locally.

**This inverts the usual risk of dead-code cleanup.** Deleting an
export can orphan the import that fed it and break the deploy even
though the deletion itself was correct.

Hit for real once: removing an unused
`export { Target as BriefIcon }` from `AnalysisBrief.jsx` left
`Target` unused in the `lucide-react` import above it.

**Always remove the now-orphaned import in the same edit**, and
verify with `CI=true npx react-scripts build` or at minimum
`npx eslint src --ext .js,.jsx` (which uses the same `react-app`
config). A plain `npm run build` locally will NOT reproduce the
failure.

## GENERATE_SOURCEMAP=false

`frontend/.env.production` sets `GENERATE_SOURCEMAP=false`. CRA
otherwise emits ~12 MB of `.map` files that Vercel serves publicly,
publishing the full readable source of an internal tool. Flip to
`true` temporarily if you need a production stack trace.

## Missing env var diagnosis

`lib/supabaseClient.js` is imported before React mounts, so
`createClient(undefined, ...)` throwing meant a blank page with no
ErrorBoundary and only "supabaseUrl is required." in the console —
omitting the thing a deployer actually needs: CRA inlines
`REACT_APP_*` at **build** time, so adding the variables in Vercel
does nothing until a new deploy. The guard names the missing variable
and says that explicitly.

## Large assets, deliberately not trimmed

- **`framer-motion` (~135 kB uncompressed)** — unavoidably in the
  main bundle. Both consumers (`JTCLogoAnimation`, `SidebarLogoHover`)
  are on the boot path.
- **`public/logo/truck-initial.svg` (1.19 MB)** — a base64 PNG in an
  SVG wrapper. Gzips to ~900 kB; lossless recompression measured at
  0% gain; 256-colour quantisation saves 39% but with visible banding
  on a brand asset. Shipping as WebP/AVIF needs sign-off on an
  animation change.

Both are owned by the boot animation, whose asset paths and timing
are frozen. They are the two biggest remaining costs; do not
"discover" them again and start refactoring.
