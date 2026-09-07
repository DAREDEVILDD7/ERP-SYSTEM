// ═════════════════════════════════════════════════════════════════════════
// Anomaly rules — pure functions that convert existing analytics fetcher
// output into ranked "priority signals" for the AnomalyRibbon at the top of
// the Analytics page.
//
// Design principle: every rule is defensive.
//   * A missing input (fetcher still loading, undefined key) yields no flag,
//     never throws.
//   * Every rule reads through guarded locals with numeric coercion.
//   * Adding a rule is a one-function edit — same pattern as insightTemplates.
//
// Every anomaly is shaped:
//   { id, severity, icon, headline, detail, promptId?, days? }
//     severity : 'critical' | 'warning' | 'info' | 'positive'
//     promptId : optional — the catalogue prompt to open on drill-in.
// ═════════════════════════════════════════════════════════════════════════

// ── Formatters ─────────────────────────────────────────────────────────

// KWD is a three-decimal currency, but at management-summary scale we round
// to whole KWD — the pennies belong in a ledger, not on a headline card.
export function fmtKwd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${Math.round(v).toLocaleString()} KWD`;
  return `${Math.round(v)} KWD`;
}

// A signed percentage like "+42%" / "-18%", or "—" for the "no baseline"
// case that `deltaPct` returns as null. Never prints "0%" for null — that
// conflates "unchanged" with "no comparison possible".
export function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${Math.round(v)}%`;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Every rule runs through this: any thrown error is logged and the rule is
// simply skipped. A single bad shape can never take the ribbon down.
function safeRule(id, fn) {
  try {
    const result = fn();
    if (!result) return null;
    return { id, ...result };
  } catch (err) {
    console.warn(`[anomalyRules:${id}]`, err?.message ?? err);
    return null;
  }
}

// ── Severity ranking ───────────────────────────────────────────────────
//
// Critical outranks warning outranks info outranks positive. Inside a tier,
// rules keep their declared order (which is authored by impact). "positive"
// is deliberately last: a manager scanning the ribbon should see problems
// before praise.
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, positive: 3 };

// ── Evidence helpers ───────────────────────────────────────────────────
//
// The four data-quality rules do not need a new query to name the rows
// behind their counts: getTopCustomers already ships the per-row screening
// output as `breakdowns.dataQualityFlags`, and each row carries the
// quotation id, date, customer and value that produced the count.
//
// `recordsFor` reshapes those rows for the explainer table. Everything about
// it is tolerant: a missing `breakdowns` key (an older cache entry, a fetcher
// still loading, a fetcher that never populated it) yields [] rather than
// throwing, and the explainer then renders its metrics with no table.
function recordsFor(customers, codes) {
  const rows = customers?.breakdowns?.dataQualityFlags;
  if (!Array.isArray(rows)) return [];
  const want = new Set(Array.isArray(codes) ? codes : [codes]);
  const out = [];
  for (const r of rows) {
    if (!r || !want.has(r.code)) continue;
    out.push({
      id: r.entityId ?? '—',
      date: r.date ?? null,
      label: r.customer ?? null,
      // Passed through raw: the value may legitimately be 0, negative, or
      // absent, and only the renderer knows how each should be printed.
      value: Object.prototype.hasOwnProperty.call(r, 'value') ? r.value : undefined,
      note: r.reason ?? r.detail ?? null,
    });
  }
  return out;
}

// A metrics row, dropped entirely when there is nothing worth showing. Keeps
// the explain blocks below free of inline conditionals.
function metric(label, value, hint) {
  if (value == null || value === '' || value === '—') return null;
  return hint ? { label, value, hint } : { label, value };
}

const compact = (arr) => arr.filter(Boolean);

// ── Main entry ─────────────────────────────────────────────────────────
//
// Takes the raw payloads from useAnalytics for a handful of sections and
// returns a ranked list of anomalies. Any payload may be null/undefined
// (still loading, still erroring) — a rule that depends on it simply skips.
//
// Every anomaly may carry an `explain` block, and that block is what the chat
// renders when the chip is clicked: what the signal detects, why it fired,
// the arithmetic behind the number, the rows responsible, and what to do
// about it. Before it existed a chip click opened a general section prompt —
// and eight of the fifteen rules pointed at `top_customers`, so clicking
// "2 anomalous quotes detected" asked "who are our top customers by billing?"
// and never answered the question the chip itself had raised. `promptId` is
// still set on every rule and now also appears inside `explain.related`, so
// the old destination is one click away rather than the only destination.
export function buildAnomalies({
  monthly, leases, customers, idle, util, maint,
} = {}) {
  const flags = [];

  // ── 1. Renewal risk: KWD/month expiring in the next 30 days ─────────
  flags.push(safeRule('renewal_risk_30', () => {
    const k = leases?.kpis;
    if (!k) return null;
    const atRiskKwd = num(k.monthlyAtRisk30);
    const count = num(k.expiring30);
    if (atRiskKwd <= 0 && count <= 0) return null;
    const sev = atRiskKwd > 1000 || count >= 5 ? 'critical' : 'warning';
    return {
      severity: sev,
      icon: 'clock',
      headline: `${fmtKwd(atRiskKwd)}/mo at renewal risk`,
      detail: `${count} lease${count === 1 ? '' : 's'} expire in ≤30 days${
        k.soonestExpiryLabel ? ` — soonest: ${k.soonestExpiryLabel}` : ''
      }.`,
      promptId: 'recent_leases',
      explain: {
        what: 'Revenue that is already contracted but stops unless somebody renews it.',
        why: `${count} open lease${count === 1 ? '' : 's'} reach${count === 1 ? 'es' : ''} the contracted end date within the next 30 days, together worth ${fmtKwd(atRiskKwd)} a month.`,
        basis: 'Counts open leases only — a unit with a monthly rate, no return recorded, and an end date inside the window. Renewal likelihood is not modelled, so this is the amount exposed, not the amount you will lose.',
        metrics: compact([
          metric('Monthly value at risk', fmtKwd(atRiskKwd)),
          metric('Leases expiring ≤30 days', String(count)),
          metric('Soonest to expire', k.soonestExpiryLabel),
        ]),
        actions: [
          'Confirm renewal intent with each account before its end date.',
          'Where renewal is unlikely, book the collection and re-market the unit so it does not sit idle.',
        ],
        related: [
          { label: 'Show the lease book', promptId: 'recent_leases' },
          { label: 'Who are these customers?', promptId: 'top_customers' },
        ],
      },
    };
  }));

  // ── 2. Customer decline: a top account falling hard ─────────────────
  flags.push(safeRule('customer_decline', () => {
    const k = customers?.kpis;
    if (!k?.largestDeclineName) return null;
    const dropPct = num(k.largestDeclinePct);
    if (dropPct >= -25) return null;    // 25% is the trigger; rule ranks by size
    const sev = dropPct <= -60 ? 'critical' : 'warning';
    return {
      severity: sev,
      icon: 'trending-down',
      headline: `${k.largestDeclineName} down ${fmtPct(dropPct)}`,
      detail: 'Billing has dropped materially vs the previous period — worth a check-in call.',
      promptId: 'top_customers',
      explain: {
        what: 'An established account whose billing has fallen sharply against the previous period of the same length.',
        why: `${k.largestDeclineName} billed ${fmtPct(dropPct)} against the comparison period — the largest single decline among the top accounts. The rule fires below −25% and escalates to critical below −60%.`,
        basis: 'Compares billed KWD in the selected window against the immediately preceding window of equal length. A customer with no billing in the earlier period is skipped rather than reported as an infinite drop.',
        metrics: compact([
          metric('Account', k.largestDeclineName),
          metric('Change vs previous period', fmtPct(dropPct)),
        ]),
        actions: [
          'Check whether the drop is a finished project or lost work — the two need very different responses.',
          'Look for open quotes with this account that have gone quiet.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'Compare the last 90 days', promptId: 'top_customers', days: 90 },
        ],
      },
    };
  }));

  // ── 3. Overdue receivables ─────────────────────────────────────────
  flags.push(safeRule('outstanding_ar', () => {
    const k = customers?.kpis;
    if (!k) return null;
    const outstanding = num(k.totalOutstanding);
    if (outstanding <= 0) return null;
    const worstName = k.worstDebtorName;
    const worstAmt = num(k.worstDebtorOutstanding);
    const sev = outstanding > 10000 ? 'critical' : outstanding > 2000 ? 'warning' : 'info';
    return {
      severity: sev,
      icon: 'wallet',
      headline: `${fmtKwd(outstanding)} outstanding`,
      detail: worstName
        ? `${worstName} owes ${fmtKwd(worstAmt)} — highest single balance.`
        : 'Accounts receivable balance to chase.',
      promptId: 'top_customers',
      explain: {
        what: 'Money invoiced but not yet collected — work already delivered that has not turned into cash.',
        why: `${fmtKwd(outstanding)} is unpaid across all accounts in this window.${worstName ? ` The largest single balance is ${worstName} at ${fmtKwd(worstAmt)}.` : ''} The rule escalates above 2,000 KWD and again above 10,000 KWD.`,
        basis: 'Invoice total minus amount paid, summed over invoices raised in the window. Cancelled invoices are excluded, and a credit note reduces the balance rather than appearing as a separate debt.',
        metrics: compact([
          metric('Total outstanding', fmtKwd(outstanding)),
          metric('Largest single balance', worstName ? fmtKwd(worstAmt) : null),
          metric('Owed by', worstName),
        ]),
        actions: [
          'Chase the largest balance first — it usually carries most of the total.',
          'Check whether any of these accounts still have equipment on hire before extending more credit.',
        ],
        related: [
          { label: 'Show billing and collections by customer', promptId: 'top_customers' },
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
        ],
      },
    };
  }));

  // ── 4. Maintenance spike: month-over-month acceleration ─────────────
  flags.push(safeRule('maint_spike', () => {
    const k = maint?.kpis;
    if (!k) return null;
    const mom = k.momDeltaPct;
    // deltaPct returns null when there is no baseline; that is not a spike.
    if (mom == null) return null;
    const v = num(mom);
    if (v < 40) return null;
    const sev = v >= 100 ? 'critical' : 'warning';
    return {
      severity: sev,
      icon: 'wrench',
      headline: `Maintenance spend ${fmtPct(v)} MoM`,
      detail: k.topIssue
        ? `Dominant issue this window: ${k.topIssue.name} (${fmtKwd(k.topIssue.cost)}).`
        : 'Latest month is materially above the previous one.',
      promptId: 'maintenance_cost',
      explain: {
        what: 'Maintenance cost accelerating month over month — usually either an ageing asset class or one expensive incident.',
        why: `The latest month is ${fmtPct(v)} against the month before. The rule fires above +40% and escalates to critical at +100%.${k.topIssue ? ` The single largest contributor is ${k.topIssue.name} at ${fmtKwd(k.topIssue.cost)}.` : ''}`,
        basis: 'Compares total maintenance cost booked in the latest complete month against the previous one. A month with no prior baseline returns no comparison and never fires this rule.',
        metrics: compact([
          metric('Change month over month', fmtPct(v)),
          metric('Largest issue', k.topIssue?.name),
          metric('Its cost', k.topIssue ? fmtKwd(k.topIssue.cost) : null),
        ]),
        actions: [
          'Separate one-off repairs from a rising baseline — only the second is a trend.',
          'If one unit dominates, compare its running cost against its earnings before spending more on it.',
        ],
        related: [
          { label: 'How is maintenance spend trending?', promptId: 'maintenance_cost' },
          { label: 'Which units eat the most maintenance?', promptId: 'maintenance_frequency' },
          { label: 'Which units earn their keep?', promptId: 'unit_pnl' },
        ],
      },
    };
  }));

  // ── 5. Idle stock ageing ──────────────────────────────────────────
  flags.push(safeRule('idle_stale', () => {
    const k = idle?.kpis;
    if (!k) return null;
    const over30 = num(k.idleOver30);
    const longest = num(k.longestIdleDays);
    if (over30 <= 0 && longest <= 30) return null;
    const sev = over30 >= 5 || longest > 90 ? 'warning' : 'info';
    const parts = [];
    if (over30 > 0) parts.push(`${over30} unit${over30 === 1 ? '' : 's'} idle >30 days`);
    if (k.longestIdleLabel && longest > 0) {
      parts.push(`longest: ${k.longestIdleLabel} (${longest}d)`);
    }
    return {
      severity: sev,
      icon: 'package',
      headline: `${over30 || 1} idle unit${over30 === 1 ? '' : 's'} — consider remarketing`,
      detail: parts.join(' · ') || 'Idle stock ageing without movement.',
      promptId: 'idle_vs_active',
      explain: {
        what: 'Fleet that is available but has not moved — capital tied up in kit nobody has hired.',
        why: `${over30} unit${over30 === 1 ? '' : 's'} ${over30 === 1 ? 'has' : 'have'} sat idle for more than 30 days.${k.longestIdleLabel && longest > 0 ? ` The longest is ${k.longestIdleLabel} at ${longest} days.` : ''} The rule escalates at five units, or when anything passes 90 days.`,
        basis: 'A live snapshot of unit status, not a historical series — it reflects the fleet as it stands right now, which is why no date filter applies to it.',
        metrics: compact([
          metric('Units idle >30 days', String(over30)),
          metric('Longest idle unit', k.longestIdleLabel),
          metric('Days idle', longest > 0 ? `${longest} days` : null),
        ]),
        actions: [
          'Check whether the idle types match what customers are actually asking for.',
          'For the longest-idle units, decide between re-marketing, relocating or disposal — every month idle is pure cost.',
        ],
        related: [
          { label: 'Which units are sitting idle?', promptId: 'idle_vs_active' },
          { label: 'How well is the fleet utilised?', promptId: 'utilization' },
          { label: 'Which types actually get rented?', promptId: 'most_rented' },
        ],
      },
    };
  }));

  // ── 6. Concentration risk: revenue clustered at the top ─────────────
  flags.push(safeRule('concentration_risk', () => {
    const k = customers?.kpis;
    if (!k) return null;
    const share = num(k.top5SharePct);
    if (share < 60) return null;
    const sev = share >= 80 ? 'warning' : 'info';
    return {
      severity: sev,
      icon: 'users',
      headline: `Top 5 customers = ${share}% of billing`,
      detail: k.topCustomer
        ? `${k.topCustomer} alone accounts for ${fmtKwd(k.topBilled)} in the window.`
        : 'Revenue is concentrated — worth diversifying.',
      promptId: 'top_customers',
      explain: {
        what: 'How much of the revenue depends on a handful of accounts. High concentration means one lost customer is a material hit.',
        why: `The five largest accounts represent ${share}% of billing in this window.${k.topCustomer ? ` ${k.topCustomer} alone accounts for ${fmtKwd(k.topBilled)}.` : ''} The rule fires above 60% and escalates above 80%.`,
        basis: 'Billed KWD per customer over the selected window, ranked, with the top five taken as a share of the total. Concentration is a structural observation rather than a fault — it is only a risk if those accounts are not secure.',
        metrics: compact([
          metric('Top 5 share of billing', `${share}%`),
          metric('Largest account', k.topCustomer),
          metric('Billed by that account', k.topCustomer ? fmtKwd(k.topBilled) : null),
        ]),
        actions: [
          'Check contract length and renewal dates on the largest accounts — concentration matters most when those are short.',
          'Compare against a longer window to see whether concentration is rising or simply seasonal.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'Compare with a full year', promptId: 'top_customers', days: 365 },
          { label: 'Which categories drive revenue?', promptId: 'revenue_by_category' },
        ],
      },
    };
  }));

  // ── 7. Fleet-in-maintenance drag on capacity ────────────────────────
  flags.push(safeRule('workshop_drag', () => {
    const k = util?.kpis;
    if (!k) return null;
    const drag = num(k.maintDragPct);
    if (drag < 15) return null;
    const sev = drag >= 30 ? 'warning' : 'info';
    return {
      severity: sev,
      icon: 'alert-triangle',
      headline: `${drag}% of fleet in workshop`,
      detail: 'Capacity constrained by maintenance rather than demand.',
      promptId: 'maintenance_frequency',
      explain: {
        what: 'The share of the fleet unavailable because it is in maintenance rather than because nobody wants it.',
        why: `${drag}% of units are currently in the workshop. The rule fires above 15% and escalates above 30%, the point at which maintenance rather than demand becomes the binding constraint on what you can hire out.`,
        basis: 'A live snapshot: units with a Maintenance status as a share of the total fleet. It says nothing about how long they have been there — a high figure with fast turnaround is far less serious than a high figure that is stuck.',
        metrics: compact([
          metric('Fleet in workshop', `${drag}%`),
          metric('Fleet utilisation', Number.isFinite(Number(k.fleetUtilPct)) ? `${num(k.fleetUtilPct)}%` : null),
        ]),
        actions: [
          'Check workshop throughput — if units are queuing rather than being worked on, the constraint is labour, not fleet condition.',
          'Cross-check against demand: workshop drag only costs revenue when the unavailable types are the ones customers want.',
        ],
        related: [
          { label: 'Which units eat the most maintenance?', promptId: 'maintenance_frequency' },
          { label: 'How well is the fleet utilised?', promptId: 'utilization' },
          { label: 'How is maintenance spend trending?', promptId: 'maintenance_cost' },
        ],
      },
    };
  }));

  // ── 8. Fleet utilisation running cold ──────────────────────────────
  flags.push(safeRule('util_cold', () => {
    const k = util?.kpis;
    if (!k) return null;
    const pct = num(k.fleetUtilPct);
    // 0% often means "no data" rather than "nothing utilised" — the
    // fleetUtilPct fetcher returns 0 when the denominator is 0.
    if (pct === 0 || pct >= 40) return null;
    const cold = Array.isArray(k.coldNames) ? k.coldNames.filter(Boolean) : [];
    return {
      severity: 'warning',
      icon: 'trending-down',
      headline: `Fleet only ${pct}% utilised`,
      detail: cold.length
        ? `Coldest lines: ${cold.slice(0, 3).join(', ')}.`
        : 'Utilisation is below a healthy threshold across most types.',
      promptId: 'utilization',
      explain: {
        what: 'The share of the fleet actually out earning, against everything you own.',
        why: `Utilisation is ${pct}%, below the 40% threshold this rule watches.${cold.length ? ` The coldest lines are ${cold.slice(0, 3).join(', ')}.` : ''}`,
        basis: 'A live snapshot of unit status — units on hire or dispatched as a share of the total fleet. A reading of exactly 0% is treated as missing data rather than a real zero, because the fetcher returns 0 when the denominator is 0, so this rule never fires on it.',
        metrics: compact([
          metric('Fleet utilisation', `${pct}%`),
          metric('Coldest lines', cold.length ? cold.slice(0, 3).join(', ') : null),
        ]),
        actions: [
          'Separate cold types from a cold fleet — a low average driven by two dead categories is a portfolio problem, not a sales one.',
          'Cross-check against workshop drag: units in maintenance are unavailable, not unwanted.',
        ],
        related: [
          { label: 'How well is the fleet utilised?', promptId: 'utilization' },
          { label: 'Which units are sitting idle?', promptId: 'idle_vs_active' },
          { label: 'Which types actually get rented?', promptId: 'most_rented' },
        ],
      },
    };
  }));

  // ── 9. Dispatches overdue for return ────────────────────────────────
  flags.push(safeRule('overdue_returns', () => {
    const k = monthly?.kpis;
    if (!k) return null;
    const count = num(k.overdueCount);
    if (count <= 0) return null;
    const sev = count >= 5 ? 'warning' : 'info';
    return {
      severity: sev,
      icon: 'clock',
      headline: `${count} dispatch${count === 1 ? '' : 'es'} overdue >30d`,
      detail: 'Assigned or in-transit dispatches without a return date past 30 days.',
      promptId: 'return_trends',
      explain: {
        what: 'Equipment that went out and has no return recorded well past the point it should have come back.',
        why: `${count} dispatch${count === 1 ? '' : 'es'} ${count === 1 ? 'is' : 'are'} still open more than 30 days after going out. The rule escalates at five.`,
        basis: 'Dispatches still in an Assigned or In Transit state with no actual return date, more than 30 days after the dispatch date. Some of these are genuinely still on hire; the rest are either a missed return or a missed data entry, and from here the two look identical.',
        metrics: compact([
          metric('Dispatches overdue >30 days', String(count)),
        ]),
        actions: [
          'Confirm which are genuinely still on site — those belong on a lease, not an open dispatch.',
          'For the rest, chase the return and close the record; until then utilisation and availability both read wrong.',
        ],
        related: [
          { label: 'Are returns coming back on time?', promptId: 'return_trends' },
          { label: 'How are dispatches trending?', promptId: 'dispatch_trends' },
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
        ],
      },
    };
  }));

  // ── 10. Data quality: active quotations with KWD 0 value ────────────
  // An approved quote at zero is almost always a mistake (missing line items,
  // wrong template). A draft at zero is less urgent but still worth a flag.
  // Severity escalates when any zero-value quote is already Approved.
  flags.push(safeRule('zero_value_quotes', () => {
    const k = customers?.kpis;
    if (!k) return null;
    // The AUDIT count — every zero-value quotation in the window whatever
    // its status. The active-pipeline count is quoted alongside it so the
    // two never look like a contradiction when a manager cross-checks
    // against the quotations table.
    const total    = num(k.zeroValueTotalCount);
    const active   = num(k.zeroValueQuoteCount);
    const approved = num(k.zeroValueApprovedCount);
    if (total <= 0) return null;
    const sev = approved > 0 ? 'critical' : 'warning';
    const screened = num(k.quotesScreened);
    return {
      severity: sev,
      icon: 'alert-triangle',
      headline: total === 1
        ? 'Anomalous quote detected: quote value is KWD 0.'
        : `${total} anomalous quotes detected: quote value is KWD 0.`,
      detail: approved > 0
        ? `${approved} already approved at zero value — a priced quotation cannot legitimately total zero. Check for missing line items.`
        : `${active} still active in the pipeline. A priced quotation cannot legitimately total zero — check for missing line items or an unfinished pricing step.`,
      promptId: 'top_customers',
      explain: {
        what: 'Quotations carrying a total of exactly zero. A priced quotation cannot legitimately total nothing, so each one is either missing its line items or was never finished being priced.',
        why: `${total} quotation${total === 1 ? '' : 's'}${screened > 0 ? ` of ${screened.toLocaleString()} screened in this window` : ''} total KWD 0. ${approved > 0
          ? `${approved} of them ${approved === 1 ? 'has' : 'have'} already been approved at zero value, which is why this is critical rather than a warning.`
          : `None have been approved yet, so this is a warning — but ${active} ${active === 1 ? 'is' : 'are'} still live in the pipeline and could be.`}`,
        basis: 'Two counts are reported on purpose. The headline is the audit count — every zero-value quotation in the window whatever its status — so it reconciles against a raw count of the quotations table. The detail quotes the active count, which excludes Cancelled and Rejected. Zero-value rows are excluded from quote value and from every forecast built on it, so they cannot quietly drag an average down.',
        metrics: compact([
          metric('Zero-value quotes (all statuses)', String(total)),
          metric('Still active in pipeline', String(active), 'Excludes Cancelled and Rejected'),
          metric('Already approved at zero', String(approved)),
          metric('Quotations screened', screened > 0 ? screened.toLocaleString() : null),
        ]),
        records: {
          title: 'Affected quotations',
          rows: recordsFor(customers, 'zero_value'),
        },
        actions: [
          'Open each quote and check whether the line items are missing or the pricing step was never completed.',
          'Re-price or void anything already approved at zero, before it becomes a dispatch nobody can invoice.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
        ],
      },
    };
  }));

  // ── 10b. Data quality: quotations with no amount at all ─────────────
  // Distinct from a zero: the field was never written, so the quote carries
  // no number in any direction. Excluded from every value total.
  flags.push(safeRule('missing_value_quotes', () => {
    const k = customers?.kpis;
    const n = num(k?.missingValueCount);
    if (n <= 0) return null;
    const screened = num(k?.quotesScreened);
    return {
      severity: 'critical',
      icon: 'alert-triangle',
      headline: n === 1
        ? 'Anomalous quote detected: quote value is missing.'
        : `${n} anomalous quotes detected: quote value is missing.`,
      detail: 'Total was never written, so these are excluded from quote value and from every forecast built on it.',
      promptId: 'top_customers',
      explain: {
        what: 'Quotations whose total was never written at all — the field is null, or holds something that is not a number.',
        why: `${n} quotation${n === 1 ? '' : 's'}${screened > 0 ? ` of ${screened.toLocaleString()} screened` : ''} carr${n === 1 ? 'ies' : 'y'} no usable total. This is distinct from a zero: a zero is a number that is wrong, a missing value is no number in any direction.`,
        basis: 'A row counts as missing when the total is null, or is a string that does not coerce to a finite number. These rows are excluded from quote value and from the value forecast — counting them as zero would understate the pipeline, and guessing a value would be worse.',
        metrics: compact([
          metric('Quotes with no total', String(n)),
          metric('Quotations screened', screened > 0 ? screened.toLocaleString() : null),
          metric('Effect on totals', 'Excluded', 'Not counted as zero'),
        ]),
        records: {
          title: 'Affected quotations',
          rows: recordsFor(customers, 'missing_value'),
        },
        actions: [
          'Enter the correct total, or void the quote if it was abandoned before pricing.',
          'If these are arriving from an import, fix the import — otherwise this recurs on every run.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
        ],
      },
    };
  }));

  // ── 10c. Data quality: negative quotation values ────────────────────
  // Almost always a credit note raised against the wrong document type.
  // Left in the totals it silently cancels out real pipeline.
  flags.push(safeRule('negative_value_quotes', () => {
    const k = customers?.kpis;
    const n = num(k?.negativeValueCount);
    if (n <= 0) return null;
    const screened = num(k?.quotesScreened);
    return {
      severity: 'critical',
      icon: 'alert-triangle',
      headline: n === 1
        ? 'Anomalous quote detected: quote value is negative.'
        : `${n} anomalous quotes detected: quote value is negative.`,
      detail: 'A negative quotation is a credit note on the wrong document type — excluded from quote value so it cannot cancel out real pipeline.',
      promptId: 'top_customers',
      explain: {
        what: 'Quotations with a total below zero. A quotation is an offer to be paid, so a negative one is almost always a credit note raised against the wrong document type.',
        why: `${n} quotation${n === 1 ? '' : 's'}${screened > 0 ? ` of ${screened.toLocaleString()} screened` : ''} total less than zero.`,
        basis: 'Any total below zero is excluded from quote value. That matters more than it sounds: left in the sum, a negative quote silently cancels out real pipeline elsewhere in the same window, and the total then looks plausible while being wrong.',
        metrics: compact([
          metric('Negative-value quotes', String(n)),
          metric('Quotations screened', screened > 0 ? screened.toLocaleString() : null),
          metric('Effect on totals', 'Excluded', 'Would otherwise cancel real pipeline'),
        ]),
        records: {
          title: 'Affected quotations',
          rows: recordsFor(customers, 'negative_value'),
        },
        actions: [
          'Re-raise each as a credit note against the invoice it belongs to, then void the quotation.',
          'If the negative was meant as a discount, put it on a line item rather than the header total.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
        ],
      },
    };
  }));

  // ── 10d. Data quality: duplicates and outliers ──────────────────────
  // Both are KEPT in the totals — deciding which of a duplicate pair is
  // real, or whether a large tender is genuine, is a human's call. They are
  // flagged so the manager knows the number may be overstated.
  flags.push(safeRule('suspect_quote_values', () => {
    const k = customers?.kpis;
    if (!k) return null;
    const dup = num(k.duplicateQuoteCount);
    const big = num(k.oversizedQuoteCount);
    if (dup <= 0 && big <= 0) return null;
    const parts = [];
    if (dup > 0) parts.push(`${dup} possible duplicate${dup === 1 ? '' : 's'} (same customer, date and value)`);
    if (big > 0) parts.push(`${big} unusually large quote${big === 1 ? '' : 's'} (25x the median)`);
    const screened = num(k.quotesScreened);
    return {
      severity: 'warning',
      icon: 'alert-triangle',
      headline: `${dup + big} quote${dup + big === 1 ? '' : 's'} need a second look`,
      detail: `${parts.join(' and ')}. Both are still counted — the pipeline figure may be overstated.`,
      promptId: 'top_customers',
      explain: {
        what: 'Quotations that are not provably wrong but do not look right: near-identical rows that may be double entry, and single quotes far larger than everything around them.',
        why: `${parts.join(' and ')}.`,
        basis: 'A duplicate is two quotations sharing the same customer, the same date and the same value. Oversized means more than 25× the median of priced quotes, and that median is suppressed below 12 priced quotes because it is not stable enough to call anything an outlier. Both kinds are KEPT in every total — deciding which of a duplicate pair is real, or whether a large tender is genuine, is a human judgement rather than an arithmetic one. The consequence is that the pipeline figure may be overstated until somebody looks.',
        metrics: compact([
          metric('Possible duplicates', dup > 0 ? String(dup) : null, 'Same customer, date and value'),
          metric('Unusually large quotes', big > 0 ? String(big) : null, 'Above 25× the median'),
          metric('Quotations screened', screened > 0 ? screened.toLocaleString() : null),
          metric('Effect on totals', 'Still counted', 'Pipeline may be overstated'),
        ]),
        records: {
          title: 'Quotes to review',
          rows: recordsFor(customers, ['duplicate', 'oversized_value']),
        },
        actions: [
          'For each duplicate pair, void the copy rather than editing both — otherwise the pipeline stays double-counted.',
          'Confirm the large quotes are genuine tenders. If they are, nothing needs to change; if not, they are distorting every average on this page.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'Which categories drive revenue?', promptId: 'revenue_by_category' },
        ],
      },
    };
  }));

  // ── 12. Positive: a customer growing fast ───────────────────────────
  flags.push(safeRule('customer_growing', () => {
    const k = customers?.kpis;
    if (!k?.fastestGrowingName) return null;
    const growPct = num(k.fastestGrowingPct);
    if (growPct < 50) return null;
    return {
      severity: 'positive',
      icon: 'trending-up',
      headline: `${k.fastestGrowingName} up ${fmtPct(growPct)}`,
      detail: 'Fastest-growing account this window — good candidate to deepen.',
      promptId: 'top_customers',
      explain: {
        what: 'The account growing fastest against the previous period — the opposite end of the same comparison that produces the decline signal.',
        why: `${k.fastestGrowingName} billed ${fmtPct(growPct)} against the comparison period. The rule only reports growth above +50%, so this is a real move rather than noise.`,
        basis: 'Billed KWD in the selected window against the immediately preceding window of equal length. An account with little or no billing in the earlier period is skipped rather than reported as spectacular growth from a tiny base.',
        metrics: compact([
          metric('Account', k.fastestGrowingName),
          metric('Change vs previous period', fmtPct(growPct)),
        ]),
        actions: [
          'Check which fleet types this account hires — growth here is a demand signal for what to buy next.',
          'Make sure credit terms and collections have kept pace with the volume.',
        ],
        related: [
          { label: 'Show billing by customer', promptId: 'top_customers' },
          { label: 'Which categories drive revenue?', promptId: 'revenue_by_category' },
        ],
      },
    };
  }));

  // ── 13. Positive: revenue up MoM on the scorecard ───────────────────
  flags.push(safeRule('revenue_up', () => {
    const k = monthly?.kpis;
    if (!k) return null;
    const delta = k.revenueDeltaPct;
    if (delta == null) return null;
    const v = num(delta);
    if (v < 20) return null;
    return {
      severity: 'positive',
      icon: 'trending-up',
      headline: `Revenue ${fmtPct(v)} vs previous period`,
      detail: `${fmtKwd(k.revenue)} billed this period vs ${fmtKwd(k.prevRevenue)} before.`,
      promptId: 'monthly_kpis',
      explain: {
        what: 'Total billed revenue growing against the previous period of the same length.',
        why: `${fmtKwd(k.revenue)} billed this period against ${fmtKwd(k.prevRevenue)} before — a move of ${fmtPct(v)}. The rule only reports growth above +20%.`,
        basis: 'Invoiced KWD in the period against the immediately preceding period. Note this is billing, not cash — see the outstanding-receivables signal for how much of it has actually been collected.',
        metrics: compact([
          metric('Billed this period', fmtKwd(k.revenue)),
          metric('Billed previously', fmtKwd(k.prevRevenue)),
          metric('Change', fmtPct(v)),
        ]),
        actions: [
          'Check collections have kept pace — revenue growth alongside a growing receivable is cash going backwards.',
          'Identify what drove it, so it can be repeated rather than just noted.',
        ],
        related: [
          { label: 'This month at a glance', promptId: 'monthly_kpis' },
          { label: 'Who is billing the most?', promptId: 'top_customers' },
          { label: 'Which categories drive revenue?', promptId: 'revenue_by_category' },
        ],
      },
    };
  }));

  // ── Rank and return ───────────────────────────────────────────────
  return flags
    .filter(Boolean)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

// A short one-liner for the "biggest concern" callout above the ribbon.
// Picks the highest-severity flag; falls back to a reassuring line when
// there is nothing to worry about and no data at all.
export function headlineFrom(anomalies) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    return { kind: 'quiet', text: 'No priority signals right now — the numbers look healthy.' };
  }
  const top = anomalies[0];
  if (top.severity === 'positive') {
    return { kind: 'positive', text: `Good news: ${top.headline.toLowerCase()}.` };
  }
  return { kind: top.severity, text: `Start here: ${top.headline}. ${top.detail}` };
}
