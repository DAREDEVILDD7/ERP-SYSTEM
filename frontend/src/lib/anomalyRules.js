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

// ── Main entry ─────────────────────────────────────────────────────────
//
// Takes the raw payloads from useAnalytics for a handful of sections and
// returns a ranked list of anomalies. Any payload may be null/undefined
// (still loading, still erroring) — a rule that depends on it simply skips.
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
    return {
      severity: 'warning',
      icon: 'trending-down',
      headline: `Fleet only ${pct}% utilised`,
      detail: Array.isArray(k.coldNames) && k.coldNames.length
        ? `Coldest lines: ${k.coldNames.slice(0, 3).join(', ')}.`
        : 'Utilisation is below a healthy threshold across most types.',
      promptId: 'utilization',
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
    };
  }));

  // ── 10. Data quality: active quotations with KWD 0 value ────────────
  // An approved quote at zero is almost always a mistake (missing line items,
  // wrong template). A draft at zero is less urgent but still worth a flag.
  // Severity escalates when any zero-value quote is already Approved.
  flags.push(safeRule('zero_value_quotes', () => {
    const k = customers?.kpis;
    if (!k) return null;
    const total    = num(k.zeroValueQuoteCount);
    const approved = num(k.zeroValueApprovedCount);
    if (total <= 0) return null;
    const sev = approved > 0 ? 'critical' : total >= 3 ? 'warning' : 'info';
    return {
      severity: sev,
      icon: 'alert-triangle',
      headline: `${total} quote${total === 1 ? '' : 's'} at KWD 0`,
      detail: approved > 0
        ? `${approved} already approved at zero value — likely a pricing or template error.`
        : 'Active quotations with no amount — check for missing line items.',
      promptId: 'top_customers',
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
