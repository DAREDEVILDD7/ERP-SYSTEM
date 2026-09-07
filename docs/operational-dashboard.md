# Operational Dashboard & Analytics POC surfaces

Two things live here. **Analytics** (Priority Signals + Forward forecast) is
where the POC's forecasting and anomaly work landed. The **Operational
Dashboard** is a separate, additive view.

## Analytics — Priority Signals

`lib/anomalyRules.js` → rendered by `components/analytics/AnomalyRibbon.jsx`.

Four record-level data-quality rules read from `getTopCustomers`, which runs
the shared `screenQuotations()` over the quotations it has already fetched —
no extra query:

| Rule id | Headline | Severity |
| --- | --- | --- |
| `zero_value_quotes` | "N anomalous quotes detected: quote value is KWD 0." | critical if any are Approved, else warning |
| `missing_value_quotes` | "N anomalous quotes detected: quote value is missing." | critical |
| `negative_value_quotes` | "N anomalous quotes detected: quote value is negative." | critical |
| `suspect_quote_values` | "N quotes need a second look" (duplicates + oversized) | warning |

The KWD 0 rule reports **two** numbers on purpose: `zeroValueTotalCount` (every
zero-value quote in the window, the audit number, used in the headline) and
`zeroValueQuoteCount` (excludes Cancelled/Rejected — the live-pipeline number,
quoted in the detail). Reporting only the second made the ribbon disagree with
any raw count of the `quotations` table. Do not collapse them back into one.

Duplicates and oversized quotes are **kept** in the totals and flagged;
zero/negative/missing/malformed are **excluded**. Same policy as the
Operational Dashboard, same code.

### Clicking a signal explains the signal

Each rule carries a `promptId` naming a related chat section, and for a while
a chip click simply opened it. That was the wrong answer for most of the
ribbon: **eight of the fifteen rules name `top_customers`** — the four
data-quality rules among them, because they are computed inside
`getTopCustomers` — so clicking *"2 anomalous quotes detected"* asked *"who
are our top customers by billing?"*. The chip already held a real explanation
in `headline`/`detail`; the strip truncated it and the click discarded it.

Every rule now also carries an optional `explain` block:

| Key | Purpose |
| --- | --- |
| `what` | What the signal detects, in one sentence |
| `why` | Why it fired, with the threshold that triggered it |
| `basis` | How it is measured, including what is excluded and why |
| `metrics[]` | `{ label, value, hint? }` — the figures behind the headline |
| `records` | `{ title, rows[] }` — the individual rows responsible, where they exist |
| `actions[]` | What to do about it |
| `related[]` | `{ label, promptId, days? }` — sections offered as follow-ups |

`components/analytics/SignalDetail.jsx` renders it into the chat, and
`explain.related` becomes the bubble's follow-up chips — so the section that
used to be the entire response is now one click further on. `promptId` is
still set on every rule and is used as the fallback follow-up when a rule
carries no `explain`, so nothing that reads it broke (`OverviewPanel` is
untouched).

**No new queries.** The `records` for the four data-quality rules come from
`customers.breakdowns.dataQualityFlags`, which `getTopCustomers` already
ships and which already carries the quotation id, date, customer and value
per row. Every other figure was already on a payload the ribbon had fetched.

The click contract changed shape with it: the chip calls
`onDrillIn({ signal })` with the whole anomaly rather than
`onDrillIn({ promptId })`. `AnalyticsPage.drillIn` branches on the presence of
`signal`; anything without it takes the original `askFollowUp` path unchanged.

Signal bubbles are snapshotted into the transcript like section bubbles, but
where a section stores `promptId` and re-derives `renderFn` from the
catalogue on reload, a signal stores the whole anomaly — it is plain data, so
it round-trips through `sessionStorage` and `hydrateMessages` rebuilds the
renderer over it.

Degradation is layered, because none of this is worth a broken chat:

- No `explain` → headline + detail, which every rule always has.
- `explain` present but a section missing → that section is skipped, no empty
  heading is left behind.
- `breakdowns` absent (an older cache entry) → metrics render, table omitted.
- Records of any length → capped at 8 with a "+N more" note.
- `SignalDetail` throws → its own boundary renders headline + detail.

## Analytics — Forward forecast (booked lease commitments)

`getForwardForecast()` in `api/analytics.js` → `OverviewPanel.jsx`. The maths
was already correct; it had no data. On 2026-09-04 only three units carried
lease commitments and all three ended in August, so every horizon returned
KWD 0.

The seed adds **24 lease commitments** to `equipment_units` (UPDATEs, not
inserts — the fleet already exists). End dates are deliberately loaded toward
the near term so the three buckets fall away:

| Horizon | Booked KWD | Open leases | Expiring in bucket |
| --- | --- | --- | --- |
| Next 30d | 44,619 | 21 | 6 |
| Next 60d | 32,340 | 15 | 4 |
| Next 90d | 24,499 | 11 | 3 |

Cumulative: **30d 44,619 · 60d 76,959 · 90d 101,458 KWD**, against 62,100
KWD/month of active commitment. The day-90 bucket is 55% of day-30 — that
decline *is* the insight: near-term revenue is contracted, day-90 is not.
Six leases worth 12,600 KWD/month expire inside 30 days.

`LEASE_BOOK` in `scripts/pocDataset.js` also carries four edge rows that must
keep contributing nothing: a zero rate (excluded by the fetcher's own
`> 0` filter), an end date before its start date, an expired-but-unreturned
lease, and two open-ended leases with no end date at all.

### Rollback

Lease rows are UPDATEs, so the seed reverses them by nulling the four lease
columns where `notes` carries the marker. The seed only writes to units whose
`notes` were **empty** and whose lease fields were **null** — verified against
the live database — and every UPDATE carries `AND notes IS NULL`, so it cannot
overwrite a real lease or anything a human typed.


### If the forecast still reads KWD 0 after seeding

The lease rows are the **last** block in `seed_poc_operations_2026.sql`, after
all five INSERT blocks. If the paste into the Supabase SQL editor is cut short,
or an older copy of the file is run, every insert lands and the 24 UPDATEs do
not. Nothing errors: `getForwardForecast` has correct maths and simply no rows,
so all three horizons render KWD 0.

Confirm with the verification SELECT the seed now ends with — it prints
`lease_commitments`, which must be 24. To repair without re-running the whole
seed, apply `frontend/seed_poc_leases_2026.sql`: rollback plus the same 24
guarded UPDATEs plus its own verification SELECT, safe to run standalone and
safe to re-run.

## Operational Dashboard

The Super Admin landing view. Answers "how is the business running" —
Quotes → Orders → Dispatch → Delivery → Returns over time, a 30/60/90-day
forecast, and record-level anomalies. The System Dashboard
(`SuperAdminDashboard.jsx`) is unchanged and still answers "is the platform
healthy"; only the tab order and the default landing view changed.

## Files

| File | Role |
| --- | --- |
| `src/components/dashboard/OperationalDashboard.jsx` | The view. KPI row, pipeline strip, trend+forecast chart, anomaly panel, then the existing `AdminDashboard` embedded unchanged. |
| `src/api/operations.js` | `getOperationalOverview()` (fetch) and `buildOperationalModel()` (pure). All Supabase access for this view lives here. |
| `src/lib/forecast.js` | Pure time-series projection. No dependencies. |
| `src/lib/operationalAnomalies.js` | Record-level screening and sanitisation. |
| `frontend/scripts/pocDataset.js` | Deterministic POC dataset generator. |
| `frontend/scripts/generate_poc_seed.js` | Emits `frontend/seed_poc_operations_2026.sql`. |
| `frontend/scripts/verify_operational_model.mjs` | Assertion harness over the real model code. |
| `src/components/analytics/SignalDetail.jsx` | Renders a priority signal's `explain` block into the chat. |
| `frontend/scripts/verify_signal_detail.cjs` | jsdom render harness for `SignalDetail` and the ribbon's click contract. |

`lib/anomalyRules.js` is a **different** module and is not affected: it
flags aggregate business signals for the Analytics page. `operationalAnomalies.js`
inspects individual rows.

## Metric definitions

Every stage is counted on exactly one stated date, so the ratios between
stages are honest:

| Metric | Source |
| --- | --- |
| Quotes | `quotations.quotation_date` |
| Quote value | `SUM(total_amount_kwd)` on the same date, bad rows excluded |
| Orders / bookings | quotations with status `Approved` or `Invoiced`, on `quotation_date` |
| Dispatches | `dispatches.dispatch_date`, falling back to `created_at` when null (the same split `getDispatchTrends` uses) |
| Deliveries | dispatches in a terminal delivered state (`Completed`, `Returned`), counted on their dispatch date |
| Returns | `actual_return_date`, falling back to `return_date` — the same "a return happened" definition `getReturnTrends` uses |
| Return rate | rolling 14-day returns ÷ dispatches. A daily ratio on counts this small is noise. |
| Backlog | running `orders − dispatches`, floored at zero |

`Invoiced` counts as an order because a quote that has already been billed
was unambiguously won. `Returned` counts as a delivery because the kit went
out and came back — it is not a failed delivery.

## Forecast model

Damped Theil–Sen with a multiplicative day-of-week profile. The steps and
the reasoning behind each choice are in the header of `lib/forecast.js`;
the short version:

- **Theil–Sen, not least squares** — one fat-finger quote is enough to tilt
  an OLS line across the whole horizon. The seeded data deliberately
  contains such outliers.
- **Day-of-week factors** — the Kuwait Fri/Sat weekend is the dominant
  wiggle in every one of these series. A trend fitted through it swings
  with whatever weekday the window happens to end on.
- **Damping (`0.985^h`)** — an undamped 90-day extrapolation of a growth
  phase produces numbers nobody believes.
- **80% band, not 95%** — at 90 days a 95% band on this data reads as "we
  have no idea", which is worse than useless on a management screen.
- **Fewer than 14 observations → `{ ok: false, reason }`** with an empty
  points array. The UI renders the reason instead of a chart.
- **`quality.staleDays`** counts trailing zero days. Seven or more and the
  dashboard says the feed went quiet rather than letting a near-zero
  forecast read as a business collapse.

`forecastSeries` never throws and never returns NaN. Anything it cannot
model comes back as `ok: false`.

## Anomaly rules

`screenQuotations` returns `{ clean, flags, stats }`. The KPI tiles, the
trend and the forecast are all computed from `clean`, so a bad row is
visible in the anomaly panel without quietly bending an average.

| Code | Severity | Excluded from totals? |
| --- | --- | --- |
| `zero_value` — "Anomalous quote detected: quote value is KWD 0." | critical | yes |
| `missing_value` — null / non-numeric total | critical | yes |
| `negative_value` | critical | yes |
| `malformed_date`, `missing_id` | warning | yes |
| `oversized_value` — > 25× the median of priced quotes | warning | **no** — may be a genuine tender |
| `duplicate` — same customer, same day, same value | warning | **no** — which of a pair is real is a human's call |

The median baseline is computed over priced quotes only (zeros would drag
it down and make ordinary quotes look oversized) and is suppressed below 12
priced quotes, where it is not stable enough to call anything an outlier.

`screenDispatches` additionally flags `return_before_dispatch`. Such a row
still counts as a dispatch but not as a return.

## POC seed

`frontend/seed_poc_operations_2026.sql` — **generated**, do not hand-edit.
Change `scripts/pocDataset.js` and re-run `node scripts/generate_poc_seed.js`.

Apply it in the Supabase SQL editor. It follows the same conventions as the
other seeds in `frontend/*.sql`: one transaction,
`SET LOCAL session_replication_role = replica` (this app's triggers would
auto-create dispatches on quote approval, rewrite requirement status, flip
`equipment_units.status`, recompute totals and emit a notification per row),
and every row carries `[JTC-POC-09]` so the DELETE block at the top makes it
re-runnable and unable to touch anything it did not create.

180 days ending 2026-09-04, so the forecast starts the day after the last
actual and is visibly a projection. Six scenario phases (normal growth,
quote spike, dispatch backlog, return surge, slowdown, recovery), three
single-day events, and 16 rows carrying intentionally invalid or borderline
values. The exact day ranges and the reasoning live in the `PHASES` table in
`scripts/pocDataset.js` and here — **not** in the seeded records or the
generated SQL. Row text is plain operational wording, so a reader of the
rows sees what an operator would have typed rather than a scenario label.
The only tag on the data is the `[JTC-POC-09]` rollback marker, which the
DELETE block has to match on.

The dataset is generated **forwards** through the chain — a spike in quotes
causes orders two days later because those specific quotes were approved,
and the backlog that appears during the congestion phase IS the orders that
did not get a dispatch row. Nothing is sampled independently.

## Verification

```
cd frontend
node scripts/verify_operational_model.mjs   # 108 assertions — operational model
node scripts/verify_analytics_signals.mjs   # 218 assertions — rules, explanations, forecast
node scripts/verify_signal_detail.cjs       #  79 checks — SignalDetail + ribbon click contract
```

`verify_analytics_signals.mjs` fires **all fifteen rules at once** and asserts
each one carries an `explain` with a `what`, a `basis`, at least one metric
and action, and `related` prompt ids that resolve against the catalogue —
which it parses out of `AnalyticsPage.jsx` rather than duplicating, so a
renamed prompt fails the check instead of silently orphaning a chip. A new
rule added without an explanation fails here rather than shipping as a chip
that explains nothing.

`verify_signal_detail.cjs` mounts the real component in jsdom across twelve
payload shapes — fully populated, no `explain` at all, empty metrics, records
that are not an array, null and negative and absent record values, an unknown
severity, a missing headline, a null anomaly, a non-object anomaly, and an
`explain` getter that throws — asserting no `NaN`, `undefined` or
`[object Object]` ever reaches the DOM, and that the boundary still shows the
headline when the body throws. It also clicks a real ribbon chip and asserts
the whole anomaly reaches `onDrillIn`.

108 assertions over the real `buildOperationalModel`, `forecastSeries` and
`screenQuotations`: every seeded scenario is visible in the series, the
chain ratios are ordered correctly, 30/60/90 forecasts start after the last
actual, every KWD 0 quote is flagged with the required wording, and eight
degenerate inputs (empty, null arrays, rows of null, garbage values, one
row, all zeros, reversed range, malformed range) all return a renderable
shape rather than throwing.
