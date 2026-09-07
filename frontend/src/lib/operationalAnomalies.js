// ═════════════════════════════════════════════════════════════════════════
// Operational anomaly detection — RECORD level.
//
// Distinct from `lib/anomalyRules.js`, which flags aggregate business
// signals ("renewal risk", "utilisation dropping") for the Analytics page.
// This module inspects individual rows and answers a different question:
// "which of these records is wrong, and why?"
//
// It is also the single sanitisation boundary for the Operational
// Dashboard. Every quotation row passes through `screenQuotations`, which
// returns BOTH the flags and a `clean` list with the bad rows removed — so
// the trend, the KPI tiles and the forecast are all computed from values
// that are known-finite, while the anomalies stay visible in their own
// panel instead of silently poisoning an average.
//
// Every finding is shaped:
//   { id, code, severity, entity, entityId, date, reason, value?, detail? }
//     severity : 'critical' | 'warning' | 'info'
//     reason   : one plain sentence, quotable on a demo screen.
// ═════════════════════════════════════════════════════════════════════════

// A quote this far above the median is treated as a keying error rather than
// a real deal. 25× is deliberately loose: genuine large tenders exist, and
// crying wolf on those is worse than missing one fat finger.
const LARGE_MULTIPLE = 25;

// Below this many priced quotes the median is not a stable enough baseline
// to call anything an outlier.
const MIN_FOR_OUTLIER = 12;

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

function toFinite(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(xs) {
  const s = xs.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtKwd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v).toLocaleString()} KWD`;
}

function isoDay(v) {
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

// ── Quotations ─────────────────────────────────────────────────────────
//
// Returns { clean, flags, stats }. `clean` carries a normalised
// `value_kwd` (always a finite number) and `date` (always 'YYYY-MM-DD' or
// null) so no downstream consumer has to re-parse either.
export function screenQuotations(rows) {
  const flags = [];
  const clean = [];
  const stats = {
    total: 0, usable: 0,
    zeroValue: 0, negative: 0, missingValue: 0, malformedDate: 0,
    duplicate: 0, oversized: 0, missingId: 0,
  };

  const list = Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
  stats.total = list.length;
  if (!list.length) return { clean, flags, stats };

  // Median over PRICED quotes only. Including the zeros would drag the
  // baseline down and make ordinary quotes look oversized.
  const priced = list
    .map(r => toFinite(r.total_amount_kwd))
    .filter(v => v != null && v > 0);
  const med = priced.length >= MIN_FOR_OUTLIER ? median(priced) : null;

  const seen = new Map();

  for (const r of list) {
    const id = typeof r.quotation_id === 'string' && r.quotation_id.trim()
      ? r.quotation_id.trim()
      : null;
    const date = isoDay(r.quotation_date) ?? isoDay(r.created_at);
    const rawValue = r.total_amount_kwd;
    const value = toFinite(rawValue);

    if (!id) {
      stats.missingId += 1;
      flags.push({
        id: `noid:${flags.length}`, code: 'missing_id', severity: 'warning',
        entity: 'Quotation', entityId: '—', date,
        reason: 'Anomalous quote detected: the record has no quotation reference.',
        detail: 'Excluded from every trend and forecast — it cannot be traced back to a document.',
      });
      continue;
    }

    if (!isoDay(r.quotation_date) && !isoDay(r.created_at)) {
      stats.malformedDate += 1;
      flags.push({
        id: `date:${id}`, code: 'malformed_date', severity: 'warning',
        entity: 'Quotation', entityId: id, date: null,
        reason: 'Anomalous quote detected: the quotation date is missing or unreadable.',
        detail: 'Excluded from the daily trend — it cannot be placed on the timeline.',
      });
      continue;
    }

    // ── The headline POC rule ──────────────────────────────────────────
    if (value === 0) {
      stats.zeroValue += 1;
      flags.push({
        id: `zero:${id}`, code: 'zero_value', severity: 'critical',
        entity: 'Quotation', entityId: id, date, value: 0,
        customer: r.customers?.company_name ?? null,
        reason: 'Anomalous quote detected: quote value is KWD 0.',
        detail: 'A priced quotation cannot legitimately total zero — check for missing line items or a pricing step that was never completed.',
      });
      continue;
    }

    if (value == null) {
      stats.missingValue += 1;
      flags.push({
        id: `null:${id}`, code: 'missing_value', severity: 'critical',
        entity: 'Quotation', entityId: id, date,
        customer: r.customers?.company_name ?? null,
        reason: `Anomalous quote detected: quote value is missing or not a number${
          rawValue == null ? '' : ` (“${String(rawValue).slice(0, 24)}”)`}.`,
        detail: 'Excluded from quote value and from the value forecast.',
      });
      continue;
    }

    if (value < 0) {
      stats.negative += 1;
      flags.push({
        id: `neg:${id}`, code: 'negative_value', severity: 'critical',
        entity: 'Quotation', entityId: id, date, value,
        customer: r.customers?.company_name ?? null,
        reason: `Anomalous quote detected: quote value is negative (${fmtKwd(value)}).`,
        detail: 'Excluded from quote value — a negative quotation is a credit note raised on the wrong document type.',
      });
      continue;
    }

    if (med != null && value > med * LARGE_MULTIPLE) {
      // Warning, not critical, and NOT excluded: an unusually large quote is
      // suspicious but may be a genuine tender, and dropping it would hide
      // real pipeline. It is flagged for a human and still counted.
      stats.oversized += 1;
      flags.push({
        id: `big:${id}`, code: 'oversized_value', severity: 'warning',
        entity: 'Quotation', entityId: id, date, value,
        customer: r.customers?.company_name ?? null,
        reason: `Unusually large quote: ${fmtKwd(value)} against a median of ${fmtKwd(med)}.`,
        detail: 'Included in the totals but worth confirming before it is read as pipeline.',
      });
    }

    // Duplicate = same customer, same day, same value to the fils. Kept in
    // `clean` (the first occurrence already is; this is the second), because
    // deciding which of a duplicate pair is real is a human's call.
    const key = `${r.customer_id ?? '?'}|${date}|${value.toFixed(3)}`;
    if (seen.has(key)) {
      stats.duplicate += 1;
      flags.push({
        id: `dup:${id}`, code: 'duplicate', severity: 'warning',
        entity: 'Quotation', entityId: id, date, value,
        customer: r.customers?.company_name ?? null,
        reason: `Possible duplicate quote: same customer, same date and same value as ${seen.get(key)}.`,
        detail: 'Both are counted until one is voided — the pipeline may be overstated by this amount.',
      });
    } else {
      seen.set(key, id);
    }

    clean.push({
      ...r,
      quotation_id: id,
      date,
      value_kwd: value,
    });
  }

  stats.usable = clean.length;
  return { clean, flags, stats };
}

// ── Dispatches ─────────────────────────────────────────────────────────
//
// Same contract. `clean` rows carry `date` (dispatch date, falling back to
// created_at the way `getDispatchTrends` already does) and `returnedOn`.
export function screenDispatches(rows) {
  const flags = [];
  const clean = [];
  const stats = { total: 0, usable: 0, malformedDate: 0, returnBeforeDispatch: 0, missingId: 0 };

  const list = Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
  stats.total = list.length;

  for (const r of list) {
    const id = typeof r.dispatch_id === 'string' && r.dispatch_id.trim() ? r.dispatch_id.trim() : null;
    if (!id) {
      stats.missingId += 1;
      continue;
    }
    const date = isoDay(r.dispatch_date) ?? isoDay(r.created_at);
    if (!date) {
      stats.malformedDate += 1;
      flags.push({
        id: `ddate:${id}`, code: 'malformed_date', severity: 'warning',
        entity: 'Dispatch', entityId: id, date: null,
        reason: 'Anomalous dispatch detected: no usable dispatch date.',
        detail: 'Excluded from the dispatch trend and the fulfilment ratio.',
      });
      continue;
    }
    const returnedOn = isoDay(r.actual_return_date) ?? isoDay(r.return_date);
    if (returnedOn && returnedOn < date) {
      stats.returnBeforeDispatch += 1;
      flags.push({
        id: `dret:${id}`, code: 'return_before_dispatch', severity: 'warning',
        entity: 'Dispatch', entityId: id, date,
        reason: `Anomalous dispatch detected: returned on ${returnedOn}, before it was dispatched on ${date}.`,
        detail: 'Counted as a dispatch but not as a return — the dates are inconsistent.',
      });
      clean.push({ ...r, dispatch_id: id, date, returnedOn: null });
      continue;
    }
    clean.push({ ...r, dispatch_id: id, date, returnedOn });
  }

  stats.usable = clean.length;
  return { clean, flags, stats };
}

// Critical first, then by date descending — the newest problem is the one a
// manager can still do something about.
export function rankFlags(flags) {
  return (Array.isArray(flags) ? flags.filter(Boolean) : [])
    .slice()
    .sort((a, b) => {
      const s = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (s !== 0) return s;
      return String(b.date ?? '').localeCompare(String(a.date ?? ''));
    });
}

export { fmtKwd };
