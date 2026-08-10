# Analytics Assistant

Reference for the Analytics page. Covers the four-layer pipeline,
the shared rules that keep the 13 sections consistent, the in-panel
loader, and the transcript scroll behaviour.

Files: `frontend/src/api/analytics.js`,
`frontend/src/lib/analyticsLabels.js`,
`frontend/src/lib/insightTemplates.js`,
`frontend/src/lib/insightBrief.js`,
`frontend/src/lib/dateRange.js`,
`frontend/src/components/analytics/sections.jsx`,
`frontend/src/components/analytics/DateRangeFilter.jsx`,
`frontend/src/components/analytics/ClaudeTypingLoader.jsx`,
`frontend/src/components/analytics/ClaudeTypingLoader.css`,
`frontend/src/components/analytics/SectionCard.jsx`,
`frontend/src/pages/analytics/AnalyticsPage.jsx`,
`frontend/src/hooks/useAnalytics.js`,
`frontend/public/analytics/claude-jtc-typing.png`.

## One page, 13 sections, four layers

- `api/analytics.js` returns `{ kpis, series, breakdowns, meta }` per
  section.
- `insightTemplates.js` turns that into `{ severity, headline, body }`
  bullets.
- `insightBrief.js` folds result + bullets into the seven-field
  analyst brief.
- `sections.jsx` renders KPIs, charts, and both.

Adding a rule is a one-function edit in the templates — no infra
change. Every layer is pure below `sections.jsx`, which is why the
whole thing is testable with a Node harness and a stubbed Supabase
client.

## Names in the UI, identifiers only on hover

The rule `analyticsLabels.js` exists to enforce. It has been violated
three times already.

A chart axis, KPI tile, ranking row, brief field, or insight sentence
shows the equipment NAME. `equipment_id` / `type_id` / `customer_id`
may appear **only** in a `title` attribute, a `NamedTooltip` `idOf`,
or a `<Detail>` inside a collapsed drill-down. (React `key`s are fine
— not rendered.)

Labels are built by `unitLabel()` **in the API layer**, once, so the
axis, tooltip, ranking, and prose all quote the same string. Deriving
them again in the UI is what produced "FL0001" on an axis next to
"Forklift" in the sentence beside it.

After editing `sections.jsx`, grep it for
`equipment_id|type_id|customer_id` and confirm every hit is one of
the permitted forms.

## Date range — one object, resolved in one place

`lib/dateRange.js`. The page holds a serialisable `{ preset }` or
`{ preset: 'custom', from, to }`. `resolveRange()` turns it into
`{ from, to, fromDate, toDate, days, label, chipLabel, explicit,
allTime }`. `winParams()` in `AnalyticsPage` is the only thing that
builds the params a section sends.

Keep the range serialisable: it is part of every React Query key. An
object rebuilt per render would refetch all 13 sections on every
keystroke.

**Refresh on change is automatic and must stay that way.** Changing
the range produces a new `ctx`, which changes each section's params,
which changes its query key — React Query refetches on its own. Do
not add manual `invalidateQueries` on range change; that would
double-fetch.

**The default range is deliberately NOT `explicit`.** With nothing
chosen a section still gets a bare `{ days }` and its own clamp
applies, so the page behaves exactly as before the filter existed.
The moment the user picks anything, `from` / `to` travel with it and
the clamps are bypassed — the header states the period and the
transcript quotes it, so silently narrowing would render an answer
contradicting its own label. Same rule that governs follow-up `days`
overrides.

**"All time"** is a bounded range with a fixed floor (2000-01-01),
not an absent lower bound. Every query stays `.gte` / `.lte` bounded
(no unbounded scans), and the whole window machinery works unchanged.
It resolves synchronously like every other preset — probing for the
oldest row would mean an extra query per section before any of the
thirteen could start. `resolved.allTime` rides through
`rangeParams` → `winParams` → `resolveWindow` → `meta.allTime` purely
so a card can print "All time" instead of the 2000-01-01 floor.
Idle-vs-active treats it as a live snapshot.

**Rolling presets keep their own day count.** `resolveRange` returns
the preset's `days` rather than measuring its own span: start-of-day
to end-of-day is 90 days *plus the rest of today*, so deriving made
"Last 90 days" resolve to 91 and shifted every baseline computed from
it.

**Utilisation and idle-vs-active take NO range**, and both say so in
their subtitles. `equipment_units.status` holds only the CURRENT
state — no history to filter, so a date range there would produce a
meaningless number. The executive scorecard is the opposite: it
aggregates dated rows, follows the range, falls back to the calendar
month when none is set. Do not "finish the job" by feeding a range
to the two live snapshots.

**`label` is prose, `chipLabel` is a name.** `label` carries a
leading article because it is written into sentences ("compared with
the last 90 days"). `chipLabel` is what a button or chip shows.
Custom ranges get `from → to` as their chip label.

**Choosing "Custom…" applies nothing until Apply.** The editor's
visibility is local component state, not inferred from the applied
range. The two date inputs are not `min` / `max`-coupled — a reversed
pair is repaired by `resolveRange` anyway.

**Header stacking for the popover:** the header needs `z-20` and the
popover `z-50`. The chat card below is a later sibling and is itself
`relative`, so at equal z-index it paints over anything escaping the
header. `overflow-hidden` on the header itself clips the popover;
that class must wrap only the decorative circles, not the header
proper.

## Date columns vs timestamp columns

`resolveWindow()` returns both (`fromIso` / `toIso` and `fromDate` /
`toDate`). Every query must use the pair matching its column type.

**`fromIso.slice(0, 10)` is the trap and it shipped:** it converts to
UTC first, so east of Greenwich a range starting on the 1st reached
`lease_start_date` / `service_date` / `issue_date` as the previous
month's last day — a silent one-day widening at both edges.

`localDate()` in `api/analytics.js` and `toDateInput()` in
`lib/dateRange.js` are the two local-time formatters. There is no
correct use of `.toISOString().slice` for a date column anywhere in
this module.

## Every windowed query is bounded on BOTH sides

Windows used to be rolling-to-now, so a lower bound was enough. "Last
month" and a custom range have a real end, and without `.lte()` they
silently included everything after it.

## Nullable business dates — use `windowedRows()`

`windowedRows()` is the shared answer to the nullable-date trap. It
issues two DISJOINT queries (primary date in range; primary date IS
NULL with a creation-timestamp fallback in range), merges them, and
stamps `effective_date` so callers bucket on one field.

Three columns have hit this: `dispatches.dispatch_date`,
`invoices.issue_date`, `lease_invoices.paid_at`. **Assume the next
nullable date does too.**

A NULL fails BOTH `.gte` and `.lte`, so a naive window filter drops
those rows silently. `createDispatch` writes
`dispatch_date: item.rental_start_date ?? null`, so a dispatch raised
from a requirement without rental dates has none — that shipped as
"Insufficient data" over a populated table.

The count is disclosed as `meta.undatedCount` rather than folded in
silently — "we dispatched on that day" and "the record was raised on
that day" are different claims.

## Status filters must be a DENY-list

Revenue was filtered with `.in('status', ['Sent','Paid','Partial'])`,
which returns nothing at all on a deployment whose invoice workflow
words its statuses differently. Reporting zero revenue is far worse
than counting an unanticipated status.

`isVoid()` / `VOID_STATUSES` name the handful that genuinely mean
"this document is not money" (cancelled / void / rejected /
declined) and everything else counts.

## Revenue — three-step basis ladder

`meta.revenueBasis` is:

- `'invoiced'` when invoices or lease invoices produced the figure;
- `'contracted'` when neither did and the value came from
  `quotations` + `quotation_items`;
- `null` when there is nothing at all.

Lease revenue prefers settled (`status = 'Paid'`) invoices and only
falls back to billed-but-unpaid when nothing is settled in the window
(`meta.leaseBasisBilled`).

The subtitle states which basis is in force — contracted value is a
legitimate answer on a system that is quoting but not yet billing,
but presenting it AS billed revenue would not be.

Do not collapse the ladder into one query.

## Most-rented — line items, contract fallback, name-or-id keys

A dispatch header carries at most one `equipment_id`; a multi-item
dispatch records its equipment in `dispatch_items` and leaves the
header link null. Counting headers alone reported "Insufficient data"
over a database full of rentals.

Headers and line items are merged, keyed on `dispatch+equipment`. A
dispatch that HAS items does not also contribute its header —
otherwise the equipment-less header row is counted as a phantom extra
rental (measured 3 instead of 2).

When a window has no dispatch activity at all it falls back to
`quotations` → `quotation_items`, and reports which source it used in
`meta.source`.

**Grouping is by type id OR NAME, never id alone.** Key is
`type_id ?? \`name:${name}\``. `type_id` stays null on a name-keyed
row. The previous-window baseline is keyed identically or a
name-keyed line never finds its own history and always reads as "new
this period".

**`kpis.top3SharePct`** is the portfolio concentration signal —
distinct from the single-line warning the template already raises.
Shown on the Fleet-spread tile, which gave up `avgPerUnit` from its
sub-line to make room; that field is still in the payload and the
template still reads it.

## Buy-vs-lease — normalise `procurements.type`

The column stores **`'Purchase'`** (that is what the ProcurementPage
`<option>` writes, what `receiveProcurement` reads back, and what the
finance page renders). The original `p.type === 'Buy'` matched zero
rows on every real environment and the section fell straight through
to "Insufficient data" over a full procurement table.

`normalizeProcMode` collapses Buy / Purchase / Purchased / Own → 'Buy'
and Lease / Rental / Rent / Hire → 'Lease'. Every read of `p.type`
inside `getProcurementVsLease` goes through it.

**Do NOT reintroduce a literal comparison.** Any future spelling
would break the section the same way, silently, with an empty card as
the only signal.

### Three-source fallback ladder

`getProcurementVsLease` has three sources:

1. Window procurements.
2. All-time procurements
   (`meta.source = 'procurements_all_time'`,
   `meta.rangeApplied = false`).
3. Synthesised from `equipment_units`
   (`meta.source = 'equipment_units'` /
   `'equipment_units_all_time'`, `meta.synthesised = true`).

The equipment fallback keys each unit off its parent `procurement_id`
when present so a multi-unit lease's monthly rate divides across
units; otherwise the unit becomes a synthetic procurement.

Subtitle discloses which source produced the numbers. `SectionCard.hasData`
accepts a populated `byEquipment` / `comparable` in addition to
`buyCount + leaseCount > 0`, so a synth path with per-unit rows but
no monthly rate on file still renders.

The empty state only fires when procurements AND `equipment_units`
are BOTH empty. Do not tighten `hasData` back to a single counter; do
not delete the fallback tiers.

## Maintenance

- **Cost** counts completed jobs only, and reports `openJobCount`
  separately so the totals read as a floor. An open job's `cost_kwd`
  is an estimate; averaging it in moves every figure.
- **Frequency** is the opposite — it counts open jobs and accrues
  their downtime to today, because a unit stuck in the workshop is
  the least available in the fleet, not the healthiest.

## Utilisation

Excludes workshop units from the denominator (in both `getUtilization`
and `getMonthlyKPIs`). A unit that cannot be hired out is not idle
capacity; counting it as such makes a maintenance problem look like a
demand problem. `maintDragPct` / `fleetInMaint` exist so the section
can still disclose what was excluded.

## Idle-vs-active — what a date range can and cannot mean

`equipment_units.status` holds only the CURRENT state, so no query
can reconstruct "what was idle last March" and the section must never
pretend otherwise.

What a range DOES do is move the reference date the idle DURATIONS
are measured against: idle days count to the end of the range rather
than to today, and a unit whose last movement postdates that date is
excluded and reported as `meta.excludedByAsOf` rather than silently
dropped.

With no explicit range the reference is `now` and every number is
exactly what it was before, which keeps the filter additive. The
subtitle states the as-of date whenever a range is in force — do not
let it read as a live snapshot then.

**Parse `updated_at` defensively; `!v` is not enough.**
`new Date('not-a-date')` yields NaN, and the original
`u.updated_at ? days(...) : 0` guard caught only null — an
unparseable string rendered as "NaNd" in the longest-idle list. Idle
days go through one helper that returns a finite count or 0. Any
column that is free-form in practice needs the same treatment.

## Empty states must be informative

An empty section must say what the database DOES hold.
`meta.emptyReason` (most-rented, dispatch trends, revenue) names the
newest record on file and tells the reader to widen the range;
`SectionCard`'s `emptyMessage` renders it.

"Insufficient data" alone gave no next step; that reads as a failure
rather than an answer. The probe query runs only when there is
nothing to show, so the normal path costs nothing.

## Section-level defensive reading

Sections read their payload through guarded locals, never
`d.kpis.x` / `d.breakdowns.y.map(...)` directly. A present-but-partial
payload otherwise throws *during render*, which is caught by
`ChatSectionBoundary` and shown as the generic "Could not render this
insight" — that boundary is a backstop, not the section's error
state.

`safeQuery` returns an ARRAY, always, and screens null elements. Row
contents are equally untrusted: aggregation loops skip falsy rows.
Screening at this single boundary is what keeps thirteen aggregators
free of per-loop defensive noise — do not push those guards back into
the loops.

## `Object.prototype`-named prop trap

**NEVER name a prop or option after an `Object.prototype` member.**
This has now bitten TWICE — `comparativeSeries`' `valueOf` option
(renamed `sumOf`) and `MiniBars`' `valueOf` prop (renamed
`pickValue`).

Destructuring a defaulted `valueOf` out of an object resolves
`Object.prototype.valueOf` through the prototype chain, so the
default NEVER applies. Every call site that omitted the prop then
invokes `Object.prototype.valueOf` as a bare function, which throws
**"Cannot convert undefined or null to object"** and takes the whole
section down through `ChatSectionBoundary`.

`toString`, `constructor`, `hasOwnProperty`, `isPrototypeOf`,
`propertyIsEnumerable` are the same hazard.

This was the root cause of both long-standing "Cannot convert
undefined or null to object" reports (Most Rented and Idle vs
Active). It evaded several reproduction attempts because
**`SectionCard` holds its loading animation over the body for
`ANALYTICS_LOADER_MIN_MS`**, so a render test that does not mock
`useMinDurationGate` renders NEITHER content nor empty state. Every
"renders fine" assertion passed vacuously. **Any section render test
MUST mock that gate to false AND force `ResponsiveContainer` to a
real size**, or it is testing an empty box.

## `comparativeSeries()`

- Summing accessor is `sumOf`, never `valueOf` (see above).
- Aligns on bucket INDEX, not calendar date. "The first eighth of
  this period" against "the first eighth of the last one" is
  comparable for any window length; a month-keyed series is not,
  because a 90-day window is not three months.
- Always returns exactly `buckets` rows — a chart with holes reads as
  missing data rather than as zero.

## `MiniBars` — the ranking-row primitive

Fourteen call sites share it; its markup is the whole ranking
presentation in one place. Change it there, never per section.

Layout is label+value on one line with the bar BELOW. The previous
`name | ────bar──── | value` layout had fixed columns
(`w-28 sm:w-36` name, `w-16` value) that made reading one row travel
the full card width and left dead gaps.

- **The bar is `aria-hidden`.** Once the value is text beside the
  label the bar is decoration; leaving it exposed made screen readers
  announce the figure twice.
- **No fixed widths anywhere in the row.** The label truncates into
  whatever space exists; the bar spans it. Same markup phone to wide
  desktop.
- `asText()` guards every text node. A `name` arriving as an object
  (a Supabase relation returned as a row) would otherwise throw
  "Objects are not valid as a React child". A caller's `format` is
  called inside a try/catch.
- **Testing note:** `ul.space-y-2 > li` does NOT identify a ranking
  row — `InsightList` shares that spacing class and its prose quotes
  the same location names. Select structurally: a MiniBars row is the
  only `<li>` whose direct child is the `aria-hidden` bar. jsdom
  mishandles `:scope`, so walk `children`.

## Brief & confidence

- **`buildBrief` returns `null` for an empty section.** Each accessor
  reports `sample`, the row count its findings rest on. Guard is
  `'sample' in section && !(Number(section.sample) > 0)`: a *present*
  non-positive sample means "there is nothing here" and the section's
  own empty state has already said so; an *absent* sample means "I
  don't know" and still earns a brief from the template's lead
  insight. Do not weaken to a truthiness check.
- **`meta.confidence` is derived, never asserted.** `confidenceFrom()`
  reads sample size and the coverage of the exact fields a conclusion
  depends on (cost on a maintenance job, a quotation link on an
  invoice, an end date on a lease). A confident-sounding brief drawn
  from four rows with half their costs missing is worse than an
  honest "Low".
- **Nullable means "no baseline", not zero.** `deltaPct()` returns
  `null` when the previous period had nothing; every template
  branches on that rather than printing "0%". Do not coerce
  `*DeltaPct`, `trendPct`, `breakEvenMonths` or `avg_interval_days`
  to 0 — "we cannot compare" and "unchanged" are different
  statements. `tmpl_monthlyKPIs` coerces its *counters* (the one
  section with no empty-state early return) but deliberately leaves
  those comparison fields alone.

## Follow-up chips

An explicit follow-up window overrides a section's clamp. Sections
clamp the page-level selector via `win(ctx, {min, max})` in
`AnalyticsPage.jsx`, but `ctx.explicit` (set only when a follow-up
chip named a window) returns the value untouched. Clamping an
explicit override renders a bubble whose user message says one window
and whose chart shows another — that shipped on two chips.

Prompts with no window at all carry `windowed: false`; `askPrompt`
will not label those with a period. `assertCatalogue()` (development
only, runs at module load) fails loudly on an unknown `promptId`, a
`days` override aimed at a non-windowed prompt, or a non-preset
window. Every follow-up must reference a real catalogue entry — a
chip that silently does nothing is indistinguishable from a broken
page.

## StreamedText — reply typing

This assistant answers from a fixed catalogue: `reply` is a static
sentence and the answer is a React section that queries Supabase and
draws charts. `StreamedText` reveals that sentence at a reading pace
because prose arriving all at once next to a 3-second loading
animation reads as a glitch. It is presentation, not generation.
Charts cannot stream and no attempt is made to fake it. If a real
streaming backend ever lands, this is the seam to feed.

- Costs no wall-clock time. `typingDurationFor` caps at 2400ms and
  the section behind the sentence shows its loader for
  `ANALYTICS_LOADER_MIN_MS` (3000ms), so typing always finishes
  inside work happening anyway. Raising the cap above 3000 would
  start actually delaying answers — do not.
- Rate scales with length, duration does not scale linearly.
  Catalogue replies span 19–189 characters; a fixed ms/char makes
  short ones finish before the eye arrives and long ones drag past
  four seconds. The total is clamped and the per-character rate
  accelerates (26ms/char at 19 chars, 12.7 at 189).
- **`StreamedText` is a LEAF component and must stay one.** The shown
  substring is its own state, so a character tick re-renders one
  `<p>`. Hoisting that state into the page would re-render the
  transcript — and re-run all 13 sections' renders, charts included —
  sixty times a second. It decides whether to animate ONCE at mount,
  so a bubble the user has already read does not retype itself when
  a newer message arrives.

## Transcript scroll — a maintained reading anchor

**ONE scroll behaviour: a maintained reading anchor.** When an
exchange is appended the question is brought to `EXCHANGE_TOP_PX`
below the top edge and HELD there while the answer grows beneath it.
No tail-follow, no "pinned to the bottom" state, no settle scroll
when generation finishes. Content growing past the fold extends
below.

- **It must be MAINTAINED, not fired once — this is the whole
  trick.** At the moment a question is appended, the only thing below
  it is the answer card at its ~240px loading height, so there is not
  yet enough scrollable content to lift the question to the top. A
  one-shot scroll therefore clamps to the maximum scroll — the bottom
  — which is the "it jumps to the end and I miss the charts" report.
  `anchorStep` re-applies the target as content arrives.
- **Clamped is a PARK, not a stop.** When the anchor cannot get
  closer with the content that exists, it stops scheduling frames but
  stays active; observers re-arm via `kickAnchor` on the next growth.
- **Achieved IS a stop.** Once the question is at the target, content
  added BELOW it cannot move it.
- **Manual scrolling wins immediately, via two detectors.** Input
  events (`wheel`, `touchstart`, navigation `keydown`) fire before
  any scrolling happens, so the anchor dies on the first wheel notch;
  the `scroll` comparison against `selfScrollTopRef` catches
  everything that moves a viewport without them (dragging the
  scrollbar, flung touch, find-in-page). Neither alone is sufficient.
  The loop's own easing fires scroll events every frame, so comparing
  against what the loop last WROTE is the only reliable way to tell
  whose motion it is.
- **Motion is eased with BOTH a ceiling and a floor.**
  `MAX_FOLLOW_PX_PER_FRAME` stops a 900px card mount reading as a
  teleport; `MIN_FOLLOW_PX_PER_FRAME` exists because a pure
  exponential ease leaves the anchor visibly "almost there" for about
  as long as it spent travelling.
- **Everything is refs.** Anchoring must never re-render the
  transcript, which would re-run all 13 sections' renders for a
  viewport concern.

`schedule` / `unschedule` wrap rAF with a latching timer fallback:
scroll and typing paths are frame-driven, and a missing scheduling
primitive would take the page down rather than degrade its animation.
The flag latches on first failure so schedule and cancel can never
disagree about mechanism.

### Two growth scrolls, two rules — do not merge them

The transcript scrolls on `messages.length` (a bubble was appended)
and again whenever its content GROWS (an answer finished and its
card expanded from the ~240px loader placeholder to full height).

- The first is unconditional because appending only ever happens when
  the user just clicked a chip.
- The second is gated on the reader being within 140px of the bottom
  — content growing on its own must never yank a reader who scrolled
  up to re-read an earlier answer.

Growth trigger is a `MutationObserver` on the scroller, which lets
this work without touching `SectionCard`, any section, or the DOM.
Attribute mutations are deliberately NOT observed — Recharts animates
attributes every frame.

Three guards stop it looping or fighting the reader: (a) act only
when `scrollHeight` actually grew (scrolling never changes it, so a
scroll cannot re-trigger); (b) only when pinned to the tail; (c) a
burst of mutations collapses into ONE scroll per animation frame,
with pinning re-checked inside that frame so grabbing the scrollbar
between mutation and scroll still wins.

Everything is refs. A `ResizeObserver` on the same element covers the
container changing size (window resize, sidebar collapse, picker
wrapping) without mutating anything. Both observers degrade to no-ops
where unavailable; `scrollTo` falls back to assigning `scrollTop`.

---

# Analytics in-panel loader

Files: `ClaudeTypingLoader.jsx`, `ClaudeTypingLoader.css`,
`SectionCard.jsx`, `AnalyticsPage.jsx`,
`public/analytics/claude-jtc-typing.png`.

## History note

**REVERTED 2026-08-07 to the last pushed GitHub version (`54ed343`).**
A day of animation work on top of it — a single-drawing mascot, split
laptop / impact-tick / ground layers, an 18-strike shared 7.8s
timeline, strike-driven loading dots, a per-keystroke laptop hop, and
an upper-body sway — was discarded in full at the user's instruction.

The four animation files (`ClaudeTypingLoader.jsx`,
`ClaudeTypingLoader.css`, `claude-jtc-typing.png`,
`build_claude_typing_sheet.py`) are byte-identical to that commit and
are the single source of truth. **Do not reintroduce any of the
discarded work** — if a brief seems to ask for it, confirm first; it
was deliberately thrown away, not lost.

## Two triggers, one component, one timing policy

1. Entering the workspace — `AnalyticsPage` mounts and covers the
   chat-surface card.
2. Submitting a prompt — each answer mounts a fresh `SectionCard`.

Both share the same component, asset, CSS, keyframes, and timings;
only the message string differs. Do not fork a second loader or
re-tune timings per site.

## `useMinDurationGate` is a floor, not a delay

Exported from `ClaudeTypingLoader.jsx` with
`ANALYTICS_LOADER_MIN_MS = 3000`. Both triggers import it so they
cannot drift apart.

Consumers must OR it with their own pending state —
`withinMinDuration || isLoading` — which keeps the query firing on
mount as it always did while guaranteeing the animation can't leave
early and stays up longer when the data is slower.

Never convert it into a delay that gates the fetch itself. One shot
per mount, which maps onto both triggers without extra state. Manual
Refresh intentionally does not re-trigger it (that path is
`isRefetching`, not `isLoading`, and keeps its spinning-icon
affordance).

## Nothing renders beneath the animation while it runs

Not children, not the error state, not the empty state. `showEmpty`
is keyed off `showLoader`, not `isLoading`, so a cached-but-empty
result cannot flash behind the artwork. On `AnalyticsPage` the
transcript and prompt picker are likewise held back until entry
finishes. Do not "optimise" by mounting content early.

## The sheet — 5 columns × 8 rows

`claude-jtc-typing.png`, 1445×1224, cell 289×153.

- COLUMN = pose (five poses the artist DREW, each a full redraw so
  typing / cap bounce / body movement is drawn rather than faked with
  transforms).
- ROW = `blink * 4 + lift`: four hand-lift levels (0 / 7 / 13 / 20
  sheet px off the keys) with eyes open, then the same four with eyes
  shut.

Laptop and ground rule are drawn INSIDE every cell — no separate
laptop, impact-tick, or ground layer. The loader loads exactly one
image.

### Sheet generation invariants

Generator: `frontend/scripts/build_claude_typing_sheet.py`.

- Poses drawn independently. Annotation badges (poses 1, 2, 4) are
  stripped; each pose is registered by *integer translation* onto two
  rigid world anchors — the laptop lid tip (x) and the ground-line
  top (y); the ground line, thickness (4-6 rows) and end points
  differing per pose, is replaced by one canonical band laid behind
  every cell; each cell carries a transparent gutter.
- Interocular distance varies ≤1.5%, so **no rescale is applied** —
  rescaling would blur the pixel art.
- Registering on the WORLD rather than on the mascot preserves each
  pose's own hand-to-keyboard contact exactly as drawn; the mascot's
  residual lean is then REAL body motion.
- Cells are authored at 578×306 and downscaled to 289×153 **one cell
  at a time** — resizing the assembled sheet let LANCZOS pull each
  cell's neighbour into its gutter, ghosting rows into each other.
  The build also forces any destination row/column whose whole source
  footprint was empty back to transparent and re-asserts gutters on
  the shipped pixels.

If the sheet is ever rebuilt, keep all of that or the loop will
jitter.

### Hand lift — synthesised from each pose's own pixels

Each arm column's whole below-the-cut content slides up as one unit;
the excised slice is invisible because the tentacle is a single flat
colour, and what the hand vacates is filled from a laptop plate
reconstructed from the union of all five poses.

The build asserts every lifted cell differs from its rest cell ONLY
left of the torso and above the ground line, so body, cap, eyes, and
laptop are provably untouched.

### Blink — a generated second half of the sheet

The eye rect (padded 2px to swallow its anti-aliased fringe) is
flooded with the dominant face tone sampled from an annulus around
it, then a 4px bar of the eye's own colour is drawn at 58% height as
the shut lid. The annulus matters: rows touching the eye carry a
highlight, and interpolating between them leaves a visibly lighter
rectangle.

### Frame ORDER is authored, not 1-2-3-4-5

The poses fall into a lean-back pair (1, 2 — cap low) and a lean-in
trio (3, 4, 5 — cap high). The sequence alternates between the groups
to get four cap bounces per cycle while keeping every head step
small, so the residual lean reads as body sway.

Poses 2, 4, and 5 are drawn with impact marks at the keys, so the
seven stops landing on them ARE the keystrokes, and `jtca-keys` dips
on exactly those seven. **Do not "tidy" the order into sequential
frames** — that reintroduces a 45px monotonic drift and a snap-back
at the loop point.

## Scoped to the panel, never full-screen

Renders `position: absolute; inset: 0` inside `SectionCard`'s body
area. That wrapper carries `relative` — load-bearing.

Sidebar / header / chat transcript / prompt picker stay visible and
interactive. Absolute positioning is also what guarantees neither
its arrival nor departure shifts the card's layout. Do not
"simplify" into the normal flow.

## Six motion layers, not one

- `.jtca-figure` — slow breathing loop (3.6s).
- `.jtca-keys` — keystroke dip / laptop shake (2.6s).
- `.jtca-lift` — hand-lift ROW (7.8s, `steps(1, end)`).
- `.jtca-blink` — eyes-open/shut ROW (12.7s, `steps(1, end)`).
- `.jtca-sprite` — pose COLUMN (2.6s, `steps(1, end)`).
- Plus the keycap indicator (1.3s) and message ellipsis (1.4s)
  outside the artwork.

Separate elements on purpose: several animations on one element would
fight over the single `transform` property (last one wins).

Nesting composes them — `.jtca-lift` is 4 rows tall and `.jtca-blink`,
wrapping it, is 2 lift-layers tall, so their translates add to
`row = blink * 4 + lift`.

`translateY` is in `%` so motion scales with the rendered artwork
and needs no per-breakpoint retuning. Keep rotation under ~0.3° —
larger rotations resample pixel art into visible mush.

## Period structure — deliberately NOT a single shared timeline

`.jtca-keys` and `.jtca-sprite` share 2.6s and both start at mount,
so the shake is phase-locked to the keystrokes and cannot drift.
`.jtca-lift` runs at 7.8s = 3 × 2.6s, so it is locked too.

`.jtca-figure` (3.6s), `.jtca-blink` (12.7s), and the ellipsis
(1.4s) are deliberately non-harmonic with 2.6s, so the composite
pose does not repeat for a long time and never reads as a short
mechanical cycle. Measured: those three slide against the typing
(ratios 18/13, 127/26, 7/13) and the whole composite repeats only
every ~693 min.

**That sliding is the design, not a defect** — it is the known trade
for a long-feeling loop. A later build replaced it with one shared
7.8s timeline and that work was discarded; if "the animation looks
out of sync" is reported again, this is the cause, and changing it
is a design decision to take explicitly rather than a bug to fix
quietly.

## Frame stepping is a transform, not `background-position`

The sheet is an `<img>` at `width: 500%` inside `.jtca-stage`
(`overflow: hidden`, ratio locked by `padding-bottom: 52.9412%`),
stepped by -20% of its own width per cell. That keeps the frame
change on the compositor instead of repainting, lands exactly on a
cell boundary at ANY rendered size with no per-breakpoint math, and
means sub-pixel rounding at the window edge can only ever expose a
cell's transparent gutter — never a neighbouring pose.

One URL also means N mounted loaders share a single decode. Do not
convert to `background-position` or to five stacked `<img>`s.

### `.jtca-sprite` MUST keep `max-width: none`

Tailwind's preflight (`@tailwind base` in `index.css`) ships
`img, video { max-width: 100%; height: auto }`. `max-width` is a
different property from `width`, so a class setting `width: 500%`
does NOT override it: preflight caps the used width at one cell and
squeezes the whole 5-cell sheet into the window. That shipped as
**~5 Claudes side by side, squashed 5:1** — which is exactly how
this was reported.

It is a pure CSS cascade bug: the DOM always held a single `<img>`,
so do not go looking for duplicate renders, remounts, or `key` churn.
`height` is already won back by class specificity, but both are
pinned in the rule so neither can regress.

Note the rule's own COMMENT quotes `max-width: 100%` as the thing
being defended against — a regex scanning the block for
`width: <n>%` will match the comment and report a false mismatch;
strip comments before parsing this file.

## Only `transform` / `opacity`

Only `transform` and `opacity` are animated so the loader stays on
the compositor. Every selector is `jtca-` prefixed (JTC Analytics) so
this CSS can never reach the truck animation, `AppLoadingGate`, or
the sidebar logo replay.

## Fade-out is a contract

`visible → false` does not unmount immediately: the container fades
for `FADE_MS` and only then unmounts, so the `<img>` stays the same
element with only an ancestor's opacity changing — the sheet is
never re-decoded. The white wash is applied inline **only** during
the exit frame (transparent while loading, so it reads as part of the
glass card instead of a pale box on top of it); it masks freshly
mounted charts so artwork and results never briefly superimpose.

## Fails soft

`onError` on the sheet degrades to the message + keys instead of a
broken-image glyph. `prefers-reduced-motion` holds the artwork still
while keeping the opacity cross-fade; its static frame is pose 3 with
the hands raised (`.jtca-sprite` -40%, `.jtca-lift` -50%,
`.jtca-blink` 0), and each of those must stay a whole multiple of
the cell step so the window can never rest on a half-cell.

## Verification

No test runner is wired to CI for analytics. Verification is two
throwaway Node harnesses:

1. Copy the `lib/` modules to `.mjs`, rewrite their relative imports,
   stub `lib/supabaseClient` with a chainable thenable. Assert (a) no
   template or brief throws across populated / zeroed / all-null
   shapes and no rendered sentence contains `undefined`, `NaN`,
   `null%` or `[object`, and (b) the aggregations hold — cancelled
   procurements excluded from quantity *and* spend, `.in()` filters
   applied, internal fields (`service_dates`, per-unit `issues` Map)
   stripped from the payload.
2. For section renders: mock `useMinDurationGate` to false, force
   `ResponsiveContainer` to a real size. Otherwise the loader hides
   the content and the test passes vacuously.

Both were clean at the time of writing.
