# JTC Ops ERP — AI Analytics Module Design

> Implementation plan for the analytics module built on top of the
> existing Supabase schema. The "AI" in this document is a
> **template-driven rule engine over deterministic SQL aggregations** —
> no LLMs, no NLP, no ML models. Every insight is produced by a
> hardcoded business rule fed by a query result.

## 1. Design principles

1. **Deterministic and explainable.** Every insight can be traced back
   to a specific SQL result and a specific rule. There are no
   probabilistic outputs, no black boxes, and no training data to
   maintain.
2. **Read-only over live data.** All queries use the existing
   Supabase JS client against the same tables the operational pages
   already read; nothing about the write path changes.
3. **RBAC-aware.** The analytics page is gated by the same
   `PermissionsContext` used elsewhere — a new `analytics` module key
   is added to `modules` / `role_permissions`, defaulting to
   `Admin` + `Super Admin` + `Head of IT` + `Finance Officer`.
   No page-level Super Admin bypass is added; `canView('analytics')`
   already returns `true` for Super Admin via the existing early-return.
4. **Fail-safe.** A missing table, a query timeout, or an empty result
   set never crashes the page — each insight renders an "insufficient
   data" state and continues.
5. **Cache-friendly.** Results are aggregated at query time (no
   client-side full-table scans). React Query is already in the app
   and is reused with a per-analysis stale time (default 5 min, tuned
   per section below).
6. **No schema changes required** beyond one seed row in `modules`
   and one seed row per role in `role_permissions`. Every column
   referenced below exists today.

## 2. Data sources in scope

Verified against the current codebase (see `frontend/src/api/*.js`
and `frontend/lease_schema_changes.sql`).

| Table                    | Columns used                                                                                                                                    |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `equipment_units`        | `equipment_id`, `type_id`, `status`, `location`, `capacity`, `serial_number`, `lease_start_date`, `lease_end_date`, `lease_monthly_kwd`, `lease_returned_at` |
| `equipment_types`        | `type_id`, `name`, `category`, `is_active`                                                                                                      |
| `dispatches`             | `dispatch_id`, `equipment_id`, `status`, `dispatch_date`, `return_date`, `destination`, `driver_name`, `vehicle_type`, `created_at`, `updated_at` |
| `maintenance`            | `maintenance_id`, `equipment_id`, `issue`, `issue_type`, `status`, `service_date`, `start_date`, `completion_date`, `cost_kwd`                  |
| `procurements`           | `procurement_id`, `title`, `type`, `status`, `total_amount_kwd`, `priority`, `vendor_id`, `lease_start_date`, `lease_end_date`, `lease_monthly_kwd`, `created_at` |
| `purchase_orders`        | `po_id`, `po_number`, `procurement_id`, `vendor_id`, `status`, `total_amount_kwd`, `expected_delivery`, `created_at`                            |
| `vendors`                | `vendor_id`, `name`, `is_active`                                                                                                                |
| `quotations`             | `quotation_id`, `customer_id`, `status`, `total_amount_kwd`, `quotation_date`, `prepared_by`, `created_at`                                      |
| `invoices`               | `invoice_id`, `customer_id`, `status`, `total_amount_kwd`, `amount_paid_kwd`, `issue_date`, `created_at`                                        |
| `customers`              | `customer_id`, `company_name`                                                                                                                   |
| `requirements`           | `requirement_id`, `customer_id`, `status`, `priority`, `created_at`, `created_by`                                                               |
| `lease_extensions`       | `extension_id`, `equipment_id`, `previous_end_date`, `new_end_date`, `monthly_rate_kwd`, `created_at`                                           |
| `lease_invoices`         | `lease_invoice_id`, `equipment_id`, `period_start`, `period_end`, `amount_kwd`, `status`, `paid_at`                                             |

## 3. Architecture

### 3.1 Layers

```
┌─────────────────────────────────────────────────────────┐
│  Analytics page  (pages/analytics/AnalyticsPage.jsx)    │
│  - Section list, filters (date range, category)          │
│  - Renders each Insight component in a grid              │
└────────────┬────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────┐
│  useAnalytics(sectionKey, params)  hook                 │
│  - Wraps React Query with per-section stale times        │
│  - Delegates to api/analytics.js                         │
└────────────┬────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────┐
│  api/analytics.js  — one function per analysis           │
│  - Pure SQL/aggregation, no side effects                 │
│  - Returns { kpis, series, breakdowns, meta }            │
└────────────┬────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────┐
│  lib/insightTemplates.js                                 │
│  - One template per analysis                             │
│  - Input: analysis result                                │
│  - Output: array of { severity, headline, body } rules   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Insight template shape

Each template is a plain JS function:

```js
export function tmpl_mostRentedEquipment(result) {
  const insights = [];
  const top = result.breakdowns.byType[0];
  if (!top) return insights;

  if (top.rentals >= 3 * (result.breakdowns.byType[1]?.rentals ?? 0)) {
    insights.push({
      severity: 'positive',
      headline: `${top.name} is your top revenue driver`,
      body:
        `${top.name} accounts for ${pct(top.rentals, result.kpis.totalRentals)} ` +
        `of all rentals this period — 3× the next category. Consider allocating ` +
        `more units of this type to keep utilization ahead of demand.`,
    });
  }
  // ...more rules...
  return insights;
}
```

Rules are pure and unit-testable. Adding an insight is a
one-function edit, no infrastructure change.

### 3.3 Refresh strategy

| Section                              | Stale time | Rationale                                       |
|--------------------------------------|-----------:|-------------------------------------------------|
| Monthly KPIs, revenue, utilization   |      5 min | Executive scorecard; fresh but not real-time    |
| Dispatch/return trends               |      2 min | Operational, changes throughout the day         |
| Maintenance frequency/cost           |     15 min | Slow-moving; daily-scale trends                 |
| Top customers, procurement vs lease  |     30 min | Rolling 30/90-day windows, low churn            |
| Idle vs active (equipment_units)     |      1 min | Live warehouse state; realtime-eligible         |

React Query's built-in `staleTime` handles this; the existing
`useRealtimeRefresh` hook is layered on top for the two live-state
sections so a warehouse move updates the tile immediately.

## 4. Analytics catalog

Naming convention: **section key** in `snake_case` (used as the React
Query key), title in English. All monetary aggregations use `_kwd`
suffix columns (Kuwaiti Dinar, existing project convention).

---

### 4.1 Most rented equipment

- **Purpose.** Identify which equipment types drive the most rental /
  dispatch volume so operations can allocate stock and sales can
  prioritise inventory-backed pitches.
- **Tables.** `dispatches`, `equipment_units`, `equipment_types`.
- **Approach.**
  ```sql
  SELECT et.type_id, et.name, et.category, COUNT(*) AS rentals
  FROM dispatches d
  JOIN equipment_units eu ON eu.equipment_id = d.equipment_id
  JOIN equipment_types et ON et.type_id = eu.type_id
  WHERE d.dispatch_date >= :from AND d.dispatch_date < :to
  GROUP BY et.type_id, et.name, et.category
  ORDER BY rentals DESC
  LIMIT 10;
  ```
  Client-side reshape: `totalRentals` = `SUM(rentals)`.
- **KPIs.** Top type name, top type rental count, top type share (%),
  count of distinct equipment types dispatched.
- **Charts.** Horizontal bar chart (type × rentals), donut of top-5
  share.
- **Insight rules.**
  1. If top type share ≥ 40% and gap to #2 ≥ 2× → **concentration
     alert** ("category X drives 60% of rentals; a single-supplier
     outage would materially cut revenue").
  2. If top-5 combined ≥ 80% → **long-tail warning** ("bottom
     categories are not contributing; review stock or discontinue").
  3. If total rentals in window < window / 30 → **low-activity flag**
     ("fewer than 1 rental/day in the last 30 days").
- **Sample output.**
  ```
  Top rented equipment (last 30 days)
  1. Air compressor 500 CFM — 42 rentals (28%)
  2. Generator 250 kVA    — 27 rentals (18%)
  3. Boom lift 40 ft      — 18 rentals (12%)
  💡 Air compressors drive nearly 3× the volume of the next
      category — consider adding units at Warehouse B where 68%
      of dispatches originate.
  ```

---

### 4.2 Most procured equipment

- **Purpose.** Show which equipment categories the business is
  actively buying / leasing in, to compare procurement flow to
  operational demand (rentals) and detect over/under-buying.
- **Tables.** `procurements` (only `type = 'Buy'` or omitted for
  all-in view), `equipment_types` via a `procurement_items` link if
  present — if the link table isn't in schema, fall back to
  aggregating on `procurements.title` grouped by heuristic word
  match (see §9 open question).
- **Approach.**
  ```sql
  SELECT p.type, COUNT(*) AS count,
         SUM(p.total_amount_kwd) FILTER (WHERE p.status NOT IN ('Cancelled','Rejected')) AS spend
  FROM procurements p
  WHERE p.created_at >= :from
  GROUP BY p.type;
  ```
- **KPIs.** Total procurements, total spend (KWD), avg deal size,
  buy vs lease split.
- **Charts.** Stacked bar (buy vs lease per month), spend line.
- **Insight rules.**
  1. If procurement growth MoM ≥ 25% → **momentum note**.
  2. If buy-share > 80% and lease demand growing (§4.9) → suggest
     **shift to leasing** for capex relief.
  3. If total spend > total revenue for same window → **cash-flow
     watch**.
- **Sample output.**
  ```
  Procurement mix (last 90 days)
  Buy:   18 orders · KWD 42,800
  Lease: 11 orders · KWD 16,200
  💡 Spend is up 31% vs the previous quarter, all in Buy — this
      is the first quarter where CapEx exceeded rental revenue.
  ```

---

### 4.3 Equipment leased / contracted in the last 30 days

- **Purpose.** Show the pipeline of new lease contracts and the
  active leased fleet, so finance and operations can plan renewals.
- **Tables.** `equipment_units` (`lease_start_date`, `lease_end_date`,
  `lease_monthly_kwd`), `equipment_types`, `procurements`.
- **Approach.**
  ```sql
  SELECT eu.equipment_id, et.name, et.category,
         eu.lease_start_date, eu.lease_end_date, eu.lease_monthly_kwd
  FROM equipment_units eu
  JOIN equipment_types et ON et.type_id = eu.type_id
  WHERE eu.lease_start_date >= (CURRENT_DATE - INTERVAL '30 days')
    AND eu.lease_returned_at IS NULL
  ORDER BY eu.lease_start_date DESC;
  ```
- **KPIs.** New leases (30d), total monthly commitment (KWD), avg
  lease term (days), leases expiring in the next 30/60/90 days.
- **Charts.** Timeline (contracts starting per day), stacked bar
  (expiring buckets 30/60/90+).
- **Insight rules.**
  1. If ≥ 5 leases expire in next 30 days → **renewal push**.
  2. If monthly commitment > 20% of last-month revenue → **exposure
     alert**.
  3. If new leases 30d = 0 → **pipeline dry** note.
- **Sample output.**
  ```
  Recent lease activity
  New in 30 days: 7 units (KWD 3,450 / mo committed)
  Expiring < 30d: 3 units — Al-Sabah Trading, Kuwait Petroleum
  💡 KWD 1,200/mo of committed leases end in October; contact
      renewal candidates now to protect recurring revenue.
  ```

---

### 4.4 Equipment with the highest maintenance frequency

- **Purpose.** Identify units and types that are consuming
  disproportionate maintenance effort so they can be repaired, retired,
  or replaced.
- **Tables.** `maintenance`, `equipment_units`, `equipment_types`.
- **Approach.**
  ```sql
  -- Per unit
  SELECT m.equipment_id, et.name, eu.capacity,
         COUNT(*) AS jobs,
         COALESCE(SUM(m.cost_kwd), 0) AS total_cost
  FROM maintenance m
  JOIN equipment_units eu ON eu.equipment_id = m.equipment_id
  JOIN equipment_types et ON et.type_id = eu.type_id
  WHERE m.service_date >= (CURRENT_DATE - INTERVAL '180 days')
  GROUP BY m.equipment_id, et.name, eu.capacity
  ORDER BY jobs DESC
  LIMIT 15;

  -- Per type (aggregate)
  SELECT et.name, COUNT(*) AS jobs,
         AVG(m.cost_kwd) FILTER (WHERE m.cost_kwd IS NOT NULL) AS avg_cost
  FROM maintenance m
  JOIN equipment_units eu ON eu.equipment_id = m.equipment_id
  JOIN equipment_types et ON et.type_id = eu.type_id
  GROUP BY et.name;
  ```
- **KPIs.** Top offender unit ID + jobs, top offender type,
  fleet-wide jobs/month, mean cost per job.
- **Charts.** Bar chart (top 10 units), heatmap by issue_type.
- **Insight rules.**
  1. If a single unit's jobs ≥ 5 in 90 days → **retire candidate**.
  2. If a type's avg cost > 2× fleet median → **quality-of-fleet
     concern** ("consider phasing out this model").
  3. If open+in-progress jobs > completed-last-month → **backlog
     alert**.
- **Sample output.**
  ```
  Highest maintenance load (last 180 days)
  EQ-104 (Boom lift 40ft) — 7 jobs, KWD 2,100 total
  EQ-057 (Air comp 500)   — 5 jobs, KWD 1,700 total
  💡 EQ-104 has been in the shop 7 times in 6 months; total
      cost now exceeds its declared monthly lease rate.
  ```

---

### 4.5 Dispatch trends

- **Purpose.** Track dispatch volume, status mix, and average
  turnaround time to detect operational bottlenecks.
- **Tables.** `dispatches`, `equipment_units`, `equipment_types`.
- **Approach.**
  ```sql
  -- Daily counts
  SELECT date_trunc('day', dispatch_date) AS day,
         status, COUNT(*) AS count
  FROM dispatches
  WHERE dispatch_date >= (CURRENT_DATE - INTERVAL '90 days')
  GROUP BY day, status
  ORDER BY day;

  -- Turnaround
  SELECT AVG(EXTRACT(EPOCH FROM (return_date - dispatch_date)) / 86400) AS avg_days
  FROM dispatches
  WHERE return_date IS NOT NULL
    AND dispatch_date >= (CURRENT_DATE - INTERVAL '90 days');
  ```
- **KPIs.** Dispatches / day (7-day avg), % completed on time (return
  ≤ scheduled), average turnaround (days), pending backlog.
- **Charts.** Line chart (daily dispatches, stacked by status), gauge
  (on-time %).
- **Insight rules.**
  1. If pending backlog > 2× daily average → **operational
     congestion**.
  2. If turnaround trending up 4+ weeks → **cycle-time regression**.
  3. If weekend dispatches ≥ 25% of total → **staffing note**.
- **Sample output.**
  ```
  Dispatch trend (last 90 days)
  Avg dispatches/day: 4.2   ·   Avg turnaround: 6.8 days
  💡 Weekly dispatch volume is up 22% vs prior period, but
      turnaround grew from 5.4 to 6.8 days — capacity is the
      constraint, not demand.
  ```

---

### 4.6 Return trends

- **Purpose.** Track how promptly equipment comes back and detect
  overdue returns before they become collection problems.
- **Tables.** `dispatches` (`return_date`, `status = 'Completed'`),
  `equipment_units` (`lease_returned_at`).
- **Approach.**
  ```sql
  -- Rental returns
  SELECT date_trunc('week', return_date) AS week, COUNT(*) AS returns
  FROM dispatches
  WHERE return_date IS NOT NULL
    AND return_date >= (CURRENT_DATE - INTERVAL '90 days')
  GROUP BY week;

  -- Lease returns (equipment_units.lease_returned_at, added in
  -- lease_schema_changes.sql)
  SELECT date_trunc('month', lease_returned_at) AS month, COUNT(*)
  FROM equipment_units
  WHERE lease_returned_at >= (CURRENT_DATE - INTERVAL '365 days')
  GROUP BY month;

  -- Overdue
  SELECT COUNT(*) FROM dispatches
  WHERE status IN ('Assigned','In Transit')
    AND dispatch_date < (CURRENT_DATE - INTERVAL '30 days')
    AND return_date IS NULL;
  ```
- **KPIs.** Returns / week (rental), returns / month (lease), overdue
  count, average days-out.
- **Charts.** Line chart (returns per week), red-flagged list of
  overdue.
- **Insight rules.**
  1. If overdue > 10 → **collections alert** (route to Ops Manager).
  2. If lease returns > lease starts for the month → **fleet
     shrinking** note.
- **Sample output.**
  ```
  Returns
  Rental returns (last 30d): 34   ·   Lease returns: 4
  Overdue rentals: 3 (avg 41 days out)
  ⚠ 3 dispatches are past 30 days without a return record.
     Escalate to Al-Sabah Trading, Kuwait Steel, ORYX.
  ```

---

### 4.7 Equipment utilization rate

- **Purpose.** Show the % of the fleet actually generating revenue at
  any given moment, per type and overall.
- **Tables.** `equipment_units.status`, `equipment_types`.
- **Approach.**
  ```sql
  SELECT et.category, et.name,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE eu.status IN ('Dispatched','Reserved')) AS in_use,
         COUNT(*) FILTER (WHERE eu.status = 'Available') AS idle,
         COUNT(*) FILTER (WHERE eu.status = 'Maintenance') AS in_maint
  FROM equipment_units eu
  JOIN equipment_types et ON et.type_id = eu.type_id
  GROUP BY et.category, et.name;
  ```
  Utilization = `in_use / (total - in_maint)`.
- **KPIs.** Fleet-wide utilization %, category with highest / lowest
  utilization, count of always-idle units (§4.10 cross-links).
- **Charts.** Horizontal bar (utilization % per type), sparkline of
  historical fleet utilization (from a nightly snapshot table — see
  §9 open question).
- **Insight rules.**
  1. Utilization > 85% → **capacity ceiling**; suggest procurement.
  2. Utilization < 30% → **overstock**; suggest lease-out or
     divestment.
  3. Any category with 100% utilization AND open requirements
     mentioning that category → **immediate stockout risk**.
- **Sample output.**
  ```
  Fleet utilization
  Overall: 62%   ·   Generators: 91%   ·   Boom lifts: 28%
  💡 Generators are near capacity while boom lifts sit largely
      idle. Consider a promotional lease-out on boom lifts to
      cover the fixed carrying cost.
  ```

---

### 4.8 Revenue by equipment category

- **Purpose.** Show which categories contribute the most revenue so
  investment decisions align with the P&L.
- **Tables.** `invoices`, `quotations` (approved), `equipment_units`,
  `equipment_types`, `lease_invoices`.
- **Approach.** Revenue attribution to a category requires linking an
  invoice / quotation to specific equipment. Two paths:
  1. **Direct:** if `invoice_items` (or `quotation_items`) rows carry
     `equipment_id` or `type_id`, aggregate on that.
  2. **Fallback:** category of the first dispatched unit against the
     originating requirement (`requirements` → `dispatches`).
  ```sql
  -- Path 1 (preferred)
  SELECT et.category, SUM(ii.amount_kwd) AS revenue
  FROM invoice_items ii
  JOIN equipment_units eu ON eu.equipment_id = ii.equipment_id
  JOIN equipment_types et ON et.type_id = eu.type_id
  JOIN invoices inv ON inv.invoice_id = ii.invoice_id
  WHERE inv.status IN ('Sent','Paid')
    AND inv.issue_date >= :from
  GROUP BY et.category;

  -- Lease revenue (from lease_invoices)
  SELECT et.category, SUM(li.amount_kwd) AS lease_revenue
  FROM lease_invoices li
  JOIN equipment_units eu ON eu.equipment_id = li.equipment_id
  JOIN equipment_types et ON et.type_id = eu.type_id
  WHERE li.status = 'Paid'
    AND li.paid_at >= :from
  GROUP BY et.category;
  ```
- **KPIs.** Total revenue, top category revenue + share %, YoY growth
  per category, rental vs lease revenue split.
- **Charts.** Pareto chart (revenue by category), pie (rental vs
  lease).
- **Insight rules.**
  1. Top category share > 50% → **concentration risk**.
  2. Category with revenue growth > 30% MoM and utilization > 80% →
     **procurement recommendation**.
  3. Category with negative growth 3+ months → **decline note**.
- **Sample output.**
  ```
  Revenue by category (last 90 days)
  Generators    — KWD 24,300 (46%)
  Compressors   — KWD 12,800 (24%)
  Access equip  — KWD  9,700 (18%)
  💡 Generator revenue grew 34% quarter-on-quarter and the
      fleet is 91% utilized. Adding 2–3 units would likely be
      revenue-accretive within 60 days.
  ```

---

### 4.9 Procurement vs leasing comparison

- **Purpose.** Help the executive team compare the cost of building the
  fleet through purchase vs leasing, in both cash-flow and P&L terms.
- **Tables.** `procurements` (`type` = Buy/Lease, `total_amount_kwd`,
  `lease_monthly_kwd`), `equipment_units`.
- **Approach.**
  ```sql
  SELECT type,
         COUNT(*) AS count,
         SUM(total_amount_kwd) AS committed_kwd,
         SUM(CASE WHEN type = 'Lease' THEN lease_monthly_kwd END) AS monthly_lease_kwd
  FROM procurements
  WHERE created_at >= (CURRENT_DATE - INTERVAL '365 days')
    AND status NOT IN ('Cancelled','Rejected')
  GROUP BY type;
  ```
  Client-side: **break-even months** for a leased vs bought unit of
  the same category = `bought_price / monthly_lease_kwd`.
- **KPIs.** Buy count, lease count, buy spend, lease monthly
  commitment, extrapolated 12-month lease cost, break-even ratio.
- **Charts.** Side-by-side bars (count + spend), scatter (unit cost
  vs monthly lease per category).
- **Insight rules.**
  1. Category avg break-even < 18 months → **buy recommendation**
     ("cheaper to own than lease after 14 months").
  2. Category avg break-even > 36 months → **lease recommendation**.
  3. High lease-monthly-commitment ratio (> 25% of revenue) →
     **cash-flow watch**.
- **Sample output.**
  ```
  Buy vs Lease (last 12 months)
  Buy:   32 units, KWD 148,000 committed
  Lease: 14 units, KWD 5,600/mo (KWD 67,200/yr extrapolated)
  💡 Generator category: buy break-even = 21 months. Given
      demand growth, buying the next 3 replacements is the
      lower-cost option over a 3-year horizon.
  ```

---

### 4.10 Idle vs active equipment

- **Purpose.** Real-time warehouse view — which units are earning
  right now vs sitting on the yard.
- **Tables.** `equipment_units.status`, `equipment_types`.
- **Approach.** Same base query as §4.7 utilization, without the
  category grouping when a raw list is needed:
  ```sql
  SELECT eu.equipment_id, et.name, et.category, eu.status, eu.location,
         eu.updated_at
  FROM equipment_units eu
  JOIN equipment_types et ON et.type_id = eu.type_id
  ORDER BY eu.status, eu.updated_at DESC;
  ```
  Idle streak (days) is computed client-side from `updated_at` while
  `status = 'Available'`.
- **KPIs.** Idle count, active count, longest idle streak,
  in-maintenance count.
- **Charts.** Donut (status mix), table of top-10 longest-idle units.
- **Insight rules.**
  1. Idle streak > 60 days → **re-market or divest**.
  2. Idle count > 40% of fleet → **oversupply**.
  3. Location with disproportionate idle count → **redeploy**.
- **Realtime.** This section subscribes via `useRealtimeRefresh`
  (existing hook, `['equipment_units']`) so a status flip on any
  Warehouse Operator's screen updates this analytics tile
  immediately.
- **Sample output.**
  ```
  Fleet state (live)
  Active: 78   ·   Idle: 41   ·   Maintenance: 6
  Longest idle: EQ-018 (Boom lift 60ft) — idle 94 days at
                Warehouse B
  💡 41 units (33%) are idle. 6 have been sitting > 60 days;
      each is booking KWD ~180/month in depreciation.
  ```

---

### 4.11 Top customers by rentals / contracts

- **Purpose.** Identify the accounts driving the business so Sales
  and Finance can prioritise service and negotiate renewals.
- **Tables.** `customers`, `quotations`, `invoices`, `requirements`,
  `dispatches`.
- **Approach.**
  ```sql
  -- Rentals (via requirements → dispatches → equipment_units → invoices)
  SELECT c.customer_id, c.company_name,
         COUNT(DISTINCT q.quotation_id) FILTER (WHERE q.status = 'Approved') AS approved_quotes,
         SUM(i.total_amount_kwd) FILTER (WHERE i.status IN ('Sent','Paid')) AS billed_kwd,
         SUM(i.amount_paid_kwd) FILTER (WHERE i.status = 'Paid') AS paid_kwd
  FROM customers c
  LEFT JOIN quotations q ON q.customer_id = c.customer_id
  LEFT JOIN invoices   i ON i.customer_id = c.customer_id
  WHERE COALESCE(q.created_at, i.created_at) >= (CURRENT_DATE - INTERVAL '365 days')
  GROUP BY c.customer_id, c.company_name
  ORDER BY billed_kwd DESC NULLS LAST
  LIMIT 20;
  ```
- **KPIs.** Top customer revenue, top-5 share, count of one-time
  customers, average revenue per customer.
- **Charts.** Table (top 20), pareto (revenue by customer).
- **Insight rules.**
  1. Top-5 share > 60% → **customer-concentration risk**.
  2. A top-10 customer with billing but no active quotation or
     dispatch in 60 days → **at-risk / re-engagement**.
  3. Outstanding (billed − paid) > 20% of billed for a top account →
     **collections priority**.
- **Sample output.**
  ```
  Top customers (last 12 months, by billed KWD)
  1. Kuwait Petroleum    — KWD 28,400  (12 approved quotes)
  2. Al-Sabah Trading    — KWD 19,900  (8 approved quotes)
  3. ORYX Contracting    — KWD 14,100  (5 approved quotes)
  ⚠ Kuwait Petroleum outstanding = KWD 6,200 (22% of billed).
     Route to Finance for follow-up.
  ```

---

### 4.12 Maintenance cost trends

- **Purpose.** Track maintenance spend over time and per equipment
  type; distinguish scheduled preventive work from break/fix.
- **Tables.** `maintenance` (`cost_kwd`, `service_date`,
  `completion_date`, `issue_type`), `equipment_units`,
  `equipment_types`.
- **Approach.**
  ```sql
  SELECT date_trunc('month', COALESCE(m.completion_date, m.service_date)) AS month,
         m.issue_type,
         SUM(m.cost_kwd) AS cost_kwd,
         COUNT(*) AS jobs
  FROM maintenance m
  WHERE COALESCE(m.completion_date, m.service_date) >= (CURRENT_DATE - INTERVAL '365 days')
    AND m.status = 'Completed'
  GROUP BY month, m.issue_type
  ORDER BY month;
  ```
- **KPIs.** MTD spend, YTD spend, avg cost per job, top issue type
  by cost, cost / active-unit ratio.
- **Charts.** Stacked area (spend per month by issue_type), horizontal
  bar (cost by type).
- **Insight rules.**
  1. Month-over-month spend up > 30% → **maintenance spike**.
  2. Issue type dominating 50%+ of spend for 2 months → **root-cause
     investigation** (e.g., recurring hydraulic failures).
  3. Cost per active unit trend rising 3+ months → **aging-fleet
     signal**.
- **Sample output.**
  ```
  Maintenance spend (12 months)
  YTD: KWD 18,900   ·   Avg cost/job: KWD 210
  💡 Hydraulic failures make up 42% of spend this quarter,
      concentrated on 3 units purchased in 2020 — consider a
      full seal-kit overhaul cycle.
  ```

---

### 4.13 Monthly operational KPIs

- **Purpose.** One-glance executive scorecard summarising the whole
  operation for the month, with month-over-month deltas.
- **Tables.** `quotations`, `invoices`, `dispatches`, `maintenance`,
  `procurements`, `equipment_units`, `requirements`, `customers`,
  `lease_invoices`.
- **Approach.** A single "KPI vector" computed by running the
  aggregations from §§4.1–4.12 for the current month, plus a
  parallel run for the prior month for deltas. Wrapped in one
  function `getMonthlyKPIs({from, to})` so the executive dashboard
  can pull all tiles with one round-trip.
  ```sql
  WITH this_month AS ( ... ), prev_month AS ( ... )
  SELECT ... , (this_month.x - prev_month.x) AS delta_x ...
  ```
- **KPIs.**
  - Revenue (billed + paid)
  - Dispatches (count + avg turnaround)
  - Utilization (%)
  - New leases / lease expiries
  - Maintenance jobs + spend
  - Procurement spend + count
  - New customers, top customer
  - Overdue returns, overdue invoices
- **Charts.** KPI tile grid (12 tiles), each with a small sparkline
  for the last 6 months.
- **Insight rules.**
  1. Revenue delta > +10% AND utilization > 80% → **healthy growth**.
  2. Revenue flat but maintenance spend up → **margin squeeze**.
  3. Overdue count up MoM → **operations note**.
- **Sample output.**
  ```
  October 2026 — Executive scorecard
  Revenue         KWD 52,400   ▲ 12%  (vs September)
  Dispatches      148          ▲  8%
  Utilization     67%          ▲  3pp
  Maintenance     KWD  2,100   ▼  4%
  Procurement     KWD  8,300   ▲ 22%
  💡 Growth is real: revenue and dispatches both up, main-
      tenance stable. Procurement spike reflects the two
      generators added this month — expect utilization tail-
      wind in November.
  ```

## 5. Shared insight-template DSL

To keep insight rules readable, each template exposes the same three
building blocks (implemented in `frontend/src/lib/insightHelpers.js`):

- `pct(numerator, denominator)` → formatted percentage
- `kwd(amount)` → formatted KWD amount
- `trend(current, previous)` → `"up 12%"` / `"down 3%"` / `"flat"`

An insight object is:

```ts
{
  severity: 'positive' | 'neutral' | 'warning' | 'critical',
  headline: string,          // < 60 chars, sentence case
  body: string,              // 1–3 sentences, plain text
  cta?: { label: string, route: string }, // optional deep link
}
```

The Analytics page renders insights as an annotated list beneath each
chart, colour-coded by severity. Severity mapping to the existing
brand palette: `positive → emerald-500`, `neutral → gray-500`,
`warning → amber-500`, `critical → primary-500` (JTC red).

## 6. Refresh & performance strategy

- **All queries are aggregation-first.** No section pulls raw table
  contents client-side. Section responses top out at ~200 rows even
  on a large tenant.
- **Date-range params default to 30 or 90 days** depending on the
  section (documented per section above), and are exposed as a
  page-level filter so a user can widen or narrow.
- **React Query** deduplicates concurrent hooks, so opening the same
  chart in two tabs of the app hits the DB once.
- **Realtime is used sparingly** — only §4.10 subscribes to
  `equipment_units`. Everything else uses stale-time only. Chatty
  realtime subscriptions across all sections would waste Supabase
  quota with no user benefit at this cadence.
- **Timeouts and empty states** are handled at the hook layer:
  a query that errors or returns no rows renders an "Insufficient
  data" panel with the section's normal header intact.

## 7. UI integration

- **Route.** `/analytics` inside the existing `ProtectedRoute` +
  `Layout` shell — same pattern as other admin-adjacent pages.
- **Sidebar / MobileNav.** New nav item **Analytics** with the
  `analytics` module key. Existing `Sidebar.jsx` / `MobileNav.jsx`
  already filter on `canAccessModule(item.key)`, so no code change
  beyond adding the item to the `NAV_ITEMS` array in
  `lib/rolePermissions.js`.
- **Page layout.** Reuse `card`, `KPICards`, `Charts` shared
  components (already used across dashboards). Layout is a 12-column
  grid of insight tiles with each analysis pinned to a fixed span.
- **No new styling primitives.** Uses the existing Tailwind palette
  (`primary-*` red, `dispatch-*` reserved for dispatch pages only,
  neutral grays). Neomorphism tokens from `DashUtils.jsx` are reused
  for KPI tiles for visual consistency with role dashboards.

## 8. Security / RBAC

- **New `modules` row.**
  ```sql
  INSERT INTO modules (module_key, label) VALUES
    ('analytics', 'Analytics')
  ON CONFLICT (module_key) DO NOTHING;
  ```
- **Seed `role_permissions`.** Grant `can_view = true` to
  `Admin`, `Head of IT`, `Finance Officer`, `Operations Manager`.
  `can_edit` is not meaningful for analytics (read-only page) so
  it is set to `false` for everyone; Super Admin's unconditional
  bypass covers the "edit" surface if we ever add saved-view
  functionality.
- **Row-level access.** Every table already read by the analytics
  queries is either already publicly SELECT-granted (see the
  existing SQL migrations) or already used by other dashboards.
  No new grants are required.
- **Per-user overrides** and **maintenance-mode** already interact
  correctly with `analytics` because the page uses `canAccessModule`,
  which honours both.
- **Auditing.** The page is read-only; no `audit_logs` write path is
  added. Filter changes, exports, or saved views (future) would
  each need their own audit entry.

## 9. Open questions and assumptions

Called out explicitly so implementation doesn't guess:

1. **Invoice/quotation line-item table.** §4.8 (revenue by category)
   assumes an `invoice_items` / `quotation_items` table exists that
   carries `equipment_id` or `type_id`. If it does not, the fallback
   path (attributing invoice revenue to the category of the first
   dispatched unit on the parent requirement) is workable but less
   accurate — flag before implementation.
2. **Procurement line items.** §4.2 (most procured equipment)
   ideally aggregates on `procurement_items.type_id`. If line items
   aren't present, the analysis degrades to `procurements.type`
   (Buy vs Lease) plus title-token heuristics.
3. **Historical utilization snapshots.** §4.7 shows a live
   utilization %; a *trend* line requires nightly snapshots of
   `(date, category, in_use, total)`. Recommended: a new
   `utilization_snapshots` table populated by a scheduled Edge
   Function or a lightweight `pg_cron` job. This is optional — the
   live tile ships without it.
4. **Dispatch scheduled return date.** §4.5 "on-time %" assumes
   `dispatches` carries a `scheduled_return_date`. If only
   `return_date` (actual) exists, the metric shifts to
   "average turnaround" without an on-time %.
5. **Currency.** Every monetary column in scope is `_kwd`. The design
   assumes a single-currency deployment; adding a currency dimension
   would require joining a `currency_rates` table (out of scope).
6. **Time zone.** Aggregations use Postgres server time. If reports
   need to align with Kuwait local time (UTC+3), add
   `AT TIME ZONE 'Asia/Kuwait'` to every `date_trunc` — trivial but
   must be applied consistently.

## 10. Delivery checklist

Rough phasing — each phase is deliverable on its own without
breaking the app:

- [ ] Phase 1 — infra: `modules` + `role_permissions` seed rows,
      `/analytics` route, sidebar entry, page shell, empty grid.
- [ ] Phase 2 — read-only KPIs: §§4.1, 4.7, 4.10 (live state:
      most-rented, utilization, idle vs active).
- [ ] Phase 3 — financial: §§4.8, 4.9, 4.11, 4.12 (revenue, buy vs
      lease, top customers, maintenance cost).
- [ ] Phase 4 — pipeline: §§4.3, 4.5, 4.6 (recent leases, dispatch
      trends, return trends).
- [ ] Phase 5 — synthesis: §§4.2, 4.4, 4.13 (procurement, maintenance
      frequency, monthly executive scorecard) + all insight templates
      turned on.
- [ ] Phase 6 — nice-to-have: exports (CSV/PDF), saved views,
      utilization-history snapshots (§9 #3).

## 11. Non-goals

- No natural-language querying or free-text prompt box.
- No predictive modelling. Forecasting is intentionally out of
  scope — the templates surface *observations*, not predictions.
- No standalone analytics database or ETL pipeline. Every query runs
  against the operational Supabase database directly.
- No third-party analytics service. All rendering is client-side
  using components the app already ships.
