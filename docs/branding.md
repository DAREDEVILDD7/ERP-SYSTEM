# Branding

## Colour scales

- **Primary — JTC red `#EE1C25`.** The full ladder is `50 #FEF2F2`,
  `100 #FEE2E2`, `500 #EE1C25` (solid buttons, active states),
  `600 #CA181F` (hover), `700 #A5141A` (active/pressed),
  `900 #5C0A0F` (deep accent). Every `bg-primary-*`, `text-primary-*`,
  `ring-primary-*`, `border-primary-*`, `focus:ring-primary-*` in the
  codebase resolves through this scale.
- **`jtc` token** (`DEFAULT #EE1C25`, `dark #CA181F`) is retained for
  the login page's `ring-jtc` / `ring-jtc-dark` utilities and points
  at the same brand values as the primary scale. Keep the two in
  sync.
- **`dispatch` scale** — pre-rebrand blue palette (`500 #3b5bdb`,
  hover `600 #364fc7`, active `700 #2f44ad`, surface `50 #f0f4ff`
  etc.). **Used only by the Dispatch module.** Do not use `dispatch-*`
  outside Dispatch.

## Shared component tokens

`frontend/src/index.css`:

- `.btn-primary` — maps to the JTC red ladder (`bg-primary-500`,
  hover `bg-primary-600`, active `bg-primary-700`) with disabled
  styling. Every "Save / Create / Submit / Update / Confirm / Add
  New" button uses it.
- `.btn-dispatch` — mirrors the old blue `.btn-primary` behaviour
  using the new `dispatch-*` scale. Used exclusively inside Dispatch.
- Aurora glass-card shadow tint variables (`--aurora-shadow`,
  `--aurora-shadow-hover`, `--aurora-shadow-sm`, `.neo-inset` inset
  shadow) use low-alpha JTC red `rgba(238, 28, 37, ...)` (alphas
  0.06 – 0.14).
- The decorative multi-colour body aurora backdrop (purple / cyan /
  pink / indigo / teal) is intentionally left untouched — a neutral
  decorative background, not a blue accent.
- `.btn-secondary` / `.card` / `.input` layout, spacing, borders,
  radius, typography are unchanged; only the focus-ring colour of
  `.input` changes.

## Semantic status colours preserved

Status-meaningful colours are **not** rebranded. Blue swatches on
`Operations Review`, `Dispatched`, `Assigned`, `Sent`, `Normal`
priority, the indigo `Quoted` badge, the dispatch-type notification
icon colour, and all green (success) / amber (warning) / red-as-error
/ gray-as-neutral mappings are left alone so their information
content survives the rebrand intact. Only accent-role blues
(interactive active states, brand chrome) were replaced.

## StatCard default

`StatCard`'s `COLOR_MAP` has a `primary` entry
(`bg-primary-50 text-primary-600`) and the default `color` prop is
`'primary'`. Dashboard KPI tiles that don't specify a colour render
in JTC red; tiles that explicitly request `color="blue"` still
resolve to that literal palette.

## Dispatch module — visually preserved

The Dispatch module's colours and styling are left **exactly** as
pre-rebrand. `DispatchManagePage.jsx`'s 27 `primary-{shade}` class
references and 6 `btn-primary` references were mechanically renamed
to `dispatch-{shade}` and `btn-dispatch` (a text-level rename only,
no logic / layout / spacing / animation change).

The `dispatch` Tailwind scale holds identical hex values to the old
`primary` scale, so rendered pixels for every Dispatch screen are
byte-for-byte identical to before the rebrand.

Other Dispatch files (`DispatchDetail.jsx`, `DispatchForm.jsx`,
`DispatchList.jsx`, `DriverAssignment.jsx`,
`DispatchDashboardPage.jsx`) already used non-`primary` colours
(hardcoded blues/indigos scoped to their own components) and are
not touched.

## Sidebar branding

Sidebar header renders only `/logo/jtc-full-logo.svg` (the same asset
as the login page and the loading-screen animation), centred in the
`h-16 px-4` header. `w-24 h-auto` expanded, fit-to-width with
`max-h-6` collapsed; `aspect-ratio: 427 / 138` prevents stretch or
crop. No user title or role rendered beside it.

Hover replay is `SidebarLogoHover.jsx` — see `docs/architecture.md`.
