// ═════════════════════════════════════════════════════════════════════════
// Human-readable labels for analytics rows.
//
// The rule this module exists to enforce: a chart axis, a KPI tile, an
// insight sentence and a ranking row all show the equipment NAME. The
// database identifier (`equipment_id`, `type_id`) is carried alongside as a
// separate field and only ever surfaces in a tooltip or hover detail.
//
// Labels are computed once, in the API layer, so the aggregation, the
// insight templates and the chart all quote the same string. Deriving them
// separately in the UI is what produced "FL0001" on one axis and "Forklift"
// in the sentence next to it.
//
// Every function is total: any row shape, including null, yields a usable
// string rather than throwing or rendering "undefined".
// ═════════════════════════════════════════════════════════════════════════

const UNKNOWN = 'Unspecified equipment';

function clean(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' ? s : '';
}

/**
 * Display name for an equipment TYPE row (`equipment_types`).
 * Falls back through category so a type row missing its name is still
 * readable rather than blank.
 */
export function typeName(type) {
  return clean(type?.name) || clean(type?.category) || UNKNOWN;
}

/**
 * Display label for a single equipment UNIT.
 *
 * Two units of the same type must not collapse to the same axis tick, so the
 * type name is qualified — by capacity when it exists (the operator-facing
 * distinction, e.g. "Forklift 3T"), otherwise by the unit id
 * ("Forklift FL0007"). When the type is unknown the id is all there is, and
 * showing it beats showing nothing.
 *
 * `unit` accepts either an `equipment_units` row or a flat
 * `{ equipment_id, type_name, capacity }` shape.
 */
export function unitLabel(unit) {
  if (!unit) return UNKNOWN;
  const name =
    clean(unit.type_name) ||
    clean(unit.equipment_types?.name) ||
    clean(unit.name);
  const cap    = clean(unit.capacity);
  const serial = clean(unit.serial_number);
  // The FULL id, not a trailing fragment of it: "Forklift 999" would collide
  // with any other unit whose id happens to end in 999, and axisLabel()
  // already handles making a long label fit.
  const code = clean(unit.equipment_id);

  // With no type name there is nothing to qualify — show the serial or id.
  if (!name) return serial || clean(unit.equipment_id) || UNKNOWN;
  // Base = type name + capacity discriminator (or id when no capacity).
  const base = cap ? `${name} ${cap}` : code ? `${name} ${code}` : name;
  // Append serial so every unit is directly traceable to the physical asset.
  return serial ? `${base} · ${serial}` : base;
}

/**
 * Truncate for a chart axis without hiding which row is which. Recharts will
 * happily render a 40-character tick straight through the plot area.
 */
export function axisLabel(label, max = 22) {
  const s = clean(label) || UNKNOWN;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Confidence in an analysis, derived from how complete the underlying data
 * is rather than asserted. Callers pass the signals they actually have:
 *
 *   sampleSize    - rows the conclusion rests on
 *   fieldCoverage - 0..1, share of those rows carrying the fields the
 *                   conclusion uses (cost, dates, type links)
 *   windowDays    - how much history the window covers
 *
 * Deliberately conservative: a confident-sounding brief drawn from four rows
 * with half their costs missing is worse than an honest "Low".
 */
export function confidenceFrom({ sampleSize = 0, fieldCoverage = 1, windowDays = 0 } = {}) {
  const n = Number(sampleSize) || 0;
  const cov = Number.isFinite(fieldCoverage) ? Math.max(0, Math.min(1, fieldCoverage)) : 0;
  const win = Number(windowDays) || 0;

  if (n === 0) {
    return { level: 'Low', reason: 'No records in this window.' };
  }
  const reasons = [];
  if (n < 5) reasons.push(`only ${n} record${n === 1 ? '' : 's'}`);
  if (cov < 0.6) reasons.push(`${Math.round(cov * 100)}% field coverage`);
  if (win > 0 && win < 30) reasons.push(`a ${win}-day window`);

  let level;
  if (n >= 20 && cov >= 0.8) level = 'High';
  else if (n >= 5 && cov >= 0.5) level = 'Medium';
  else level = 'Low';

  return {
    level,
    reason: reasons.length
      ? `Based on ${reasons.join(', ')}.`
      : `Based on ${n} records with ${Math.round(cov * 100)}% field coverage.`,
  };
}

/**
 * Share of rows for which `predicate` holds — the field-coverage input above.
 * Returns 1 for an empty set so "no rows" is reported as a sample-size
 * problem (which it is) rather than doubling as a coverage problem.
 */
export function coverage(rows, predicate) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  let hit = 0;
  for (const r of rows) {
    try { if (predicate(r)) hit += 1; } catch (_) { /* row shape mismatch counts as a miss */ }
  }
  return hit / rows.length;
}

/** Percentage change, or null when there is no meaningful baseline. */
export function deltaPct(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return Math.round(((c - p) / p) * 100);
}

/** "up 18%" / "down 4%" / "flat" — the phrasing the briefs read in. */
export function trendPhrase(delta) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return 'flat';
  if (delta === 0) return 'flat';
  return delta > 0 ? `up ${delta}%` : `down ${Math.abs(delta)}%`;
}

// ── Period phrasing — the fix for "this month" appearing when the user
// picked All Time.
//
// Every brief and template used to hardcode phrases like "over the last
// 30 days" or "this month vs prior month". Those read correctly for the
// default rolling window but became factually wrong the moment a user
// picked "All time" (there is no meaningful prior) or a custom range
// ("the last 8,752 days" is not a real thing). `describeRange` centralises
// the phrasing so a single meta object drives what the whole brief says.
//
// The helper is defensive by shape: any meta variant produced by any
// fetcher — with `allTime` / `explicitRange` / `rangeApplied` / `fromDate`
// / `toDate` / `windowDays` in any combination — resolves to a usable set
// of phrases. Absent everything, it falls back to "in this window".
//
// Returns:
//   {
//     periodPhrase   : "over the last 30 days" | "between 2025-06-01 and
//                      2025-06-30" | "across all recorded activity" |
//                      "in this window"
//     shortPeriod    : "last 30 days" | "the selected period" |
//                      "all time" | "the window"
//     hasPrior       : boolean — true when a same-length comparison is
//                      meaningful
//     previousPhrase : "the previous 30 days" | "the equivalent prior
//                      period" | null (when hasPrior is false)
//     rangeMode      : 'allTime' | 'explicit' | 'rolling' | 'unknown'
//   }
export function describeRange(meta) {
  const m = meta ?? {};
  const win = Number(m.windowDays);
  const hasWin = Number.isFinite(win) && win > 0;
  const from = m.fromDate ?? null;
  const to = m.toDate ?? null;

  // "All time" — a bounded query that spans the entire history. There is
  // no meaningful equal-length prior on either the rolling or the explicit
  // interpretation, so `hasPrior` is false and the previous phrase is null.
  if (m.allTime === true) {
    return {
      periodPhrase: 'across all recorded activity',
      shortPeriod: 'all time',
      hasPrior: false,
      previousPhrase: null,
      rangeMode: 'allTime',
    };
  }

  // An explicit range (custom pick or a preset like "This month" / "Last
  // month"). If the fetcher exposed fromDate/toDate, quote them literally
  // — that is the period the user actually sees on the chip. A same-length
  // prior is meaningful because the fetcher's `resolvePrevWindow` returns
  // one, but the phrasing must not say "the previous N days" because the
  // user did not choose N days.
  const explicit =
    m.explicitRange === true ||
    m.rangeApplied === true ||
    (!!from && !!to && !hasWin);
  if (explicit && from && to) {
    return {
      periodPhrase: `between ${from} and ${to}`,
      shortPeriod: 'the selected period',
      hasPrior: true,
      previousPhrase: 'the equivalent prior period',
      rangeMode: 'explicit',
    };
  }

  // The classic rolling window — this is what all the "last N days"
  // wording was written against and remains the right phrasing for it.
  if (hasWin) {
    return {
      periodPhrase: `over the last ${win} days`,
      shortPeriod: `last ${win} days`,
      hasPrior: true,
      previousPhrase: `the previous ${win} days`,
      rangeMode: 'rolling',
    };
  }

  // Snapshot sections (utilisation, idle-vs-active with no range) have no
  // window at all. "In this window" reads as generic filler; nothing
  // measured against something that doesn't exist.
  return {
    periodPhrase: 'in this window',
    shortPeriod: 'the window',
    hasPrior: false,
    previousPhrase: null,
    rangeMode: 'unknown',
  };
}
