// ═════════════════════════════════════════════════════════════════════════
// Forecast — pure, dependency-free time-series projection for the
// Operational Dashboard.
//
// Design principle: this module NEVER throws and NEVER returns NaN.
// It is fed straight from Supabase rows that may be sparse, malformed,
// negative, null or duplicated, and the dashboard renders whatever comes
// back without a second layer of guards. Anything it cannot model returns
// `{ ok: false, reason }` with an empty `points` array, which the UI shows
// as an honest "not enough history yet" state rather than a broken chart.
//
// The model is deliberately simple and explainable — a POC audience has to
// be able to follow WHY the line goes where it goes:
//
//   1. Clean      — coerce to finite numbers, drop the rest.
//   2. Deseason   — divide out a multiplicative day-of-week factor derived
//                   from the ratio of each day to its centred 7-day mean.
//                   Kuwait's Fri/Sat weekend is the dominant wiggle in every
//                   operational series here, and a trend fitted through it
//                   without removing it first swings with whatever weekday
//                   the window happens to end on.
//   3. Trend      — Theil-Sen slope (median of pairwise slopes) rather than
//                   least squares. One 250,000 KWD fat-finger quote is
//                   enough to tilt an OLS line across the whole horizon;
//                   the median slope ignores it. That matters because the
//                   seeded data deliberately contains such outliers.
//   4. Damp       — the slope decays by `phi^h`. An undamped 90-day
//                   extrapolation of a growth phase produces numbers no one
//                   in the room believes; damping is what keeps day 90
//                   defensible.
//   5. Reseason   — multiply the day-of-week factor back in.
//   6. Band       — ±z·σ from in-sample residuals, widened with √h.
//
// Counts are clamped at zero (you cannot dispatch -3 units); currency
// series are not, because a credit note legitimately is negative.
// ═════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;

// 80% two-sided normal quantile. Deliberately not 95%: at 90 days a 95%
// band on this data is so wide it reads as "we have no idea", which is
// worse than useless on a management screen.
const Z_80 = 1.2816;

// Below this many usable observations there is nothing to fit — a slope
// through a fortnight of noise is a guess wearing a suit.
const MIN_POINTS = 14;

// Trend damping per day ahead. 0.985^90 ≈ 0.26, so the last month of a
// 90-day horizon carries roughly a quarter of the fitted daily drift.
const DAMPING = 0.985;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function toFinite(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Date helpers ───────────────────────────────────────────────────────
//
// Everything in this module keys on a 'YYYY-MM-DD' string and converts to
// UTC noon before doing arithmetic. Noon (not midnight) so that a DST shift
// in any locale can never round a date to the previous day.

export function isoDay(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : null;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayMs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

export function addDays(iso, n) {
  const ms = dayMs(iso);
  if (ms == null) return null;
  return new Date(ms + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysApart(fromIso, toIso) {
  const a = dayMs(fromIso), b = dayMs(toIso);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY_MS);
}

// Day-of-week index for the seasonal factor table. UTC-noon keying means
// this agrees with `isoDay` for every timezone.
function dow(iso) {
  const ms = dayMs(iso);
  return ms == null ? null : new Date(ms).getUTCDay();
}

// ── Statistics ─────────────────────────────────────────────────────────

function median(values) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Median of pairwise slopes. Capped at ~4,000 pairs by striding, so a long
// window cannot turn an O(n²) scan into a visible frame drop.
function theilSen(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const stride = Math.max(1, Math.ceil(Math.sqrt((n * n) / 8000)));
  const slopes = [];
  for (let i = 0; i < n; i += stride) {
    for (let j = i + 1; j < n; j += stride) {
      const s = (ys[j] - ys[i]) / (j - i);
      if (Number.isFinite(s)) slopes.push(s);
    }
  }
  return median(slopes) ?? 0;
}

// ── Series building ────────────────────────────────────────────────────
//
// A gap-free daily series is a precondition for every step above: a missing
// Friday must read as a real zero, not as "the line simply continues". This
// is the only place zero-filling happens.

export function buildDailySeries(counts, fromIso, toIso) {
  const out = [];
  const start = dayMs(fromIso), end = dayMs(toIso);
  if (start == null || end == null || end < start) return out;
  // A malformed range must not spin forever; three years is far beyond any
  // window this dashboard offers.
  const span = Math.min(Math.round((end - start) / DAY_MS), 1095);
  for (let i = 0; i <= span; i++) {
    const iso = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const v = toFinite(counts instanceof Map ? counts.get(iso) : counts?.[iso]);
    out.push({ date: iso, value: v ?? 0 });
  }
  return out;
}

// Seven multiplicative factors normalised to average 1. Days with no
// observations fall back to 1 (neutral) rather than 0, which would zero out
// the whole forecast for that weekday.
function seasonalFactors(points) {
  const ratios = [[], [], [], [], [], [], []];
  for (let i = 3; i < points.length - 3; i++) {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += points[i + k].value;
    const mean = sum / 7;
    if (mean <= 0) continue;
    const d = dow(points[i].date);
    if (d != null) ratios[d].push(points[i].value / mean);
  }
  const raw = ratios.map(r => {
    const m = median(r);
    return isNum(m) && m > 0 ? m : 1;
  });
  const avg = raw.reduce((s, v) => s + v, 0) / 7;
  if (!isNum(avg) || avg <= 0) return [1, 1, 1, 1, 1, 1, 1];
  return raw.map(v => v / avg);
}

// ── Main entry ─────────────────────────────────────────────────────────
//
// `history` is the output of buildDailySeries (or anything shaped
// `{ date, value }`). `horizons` are the day counts the caller wants
// summarised — the dashboard asks for 30/60/90.
//
// Returns:
//   ok        — false when the series cannot support a forecast.
//   points    — [{ date, forecast, lower, upper }] for max(horizons) days.
//   totals    — { 30: {...}, 60: {...}, 90: {...} } cumulative sums.
//   quality   — inputs an operator needs to judge the number.
export function forecastSeries(history, {
  horizons = [30, 60, 90],
  integer = false,
  clampAtZero = true,
  fitWindow = 120,
} = {}) {
  const empty = (reason) => ({
    ok: false,
    reason,
    points: [],
    totals: {},
    quality: {
      observations: 0, fittedOn: 0, staleDays: 0, lastNonZeroDate: null,
      slopePerDay: 0, level: 0, sigma: 0, seasonal: null,
    },
  });

  try {
    const clean = (Array.isArray(history) ? history : [])
      .filter(p => p && isoDay(p.date))
      .map(p => ({ date: isoDay(p.date), value: toFinite(p.value) ?? 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (clean.length < MIN_POINTS) {
      return empty(`Needs at least ${MIN_POINTS} days of history — ${clean.length} available.`);
    }

    // Fit on the tail only. Six months of history is useful context on the
    // chart but a stale first quarter should not steer next month's number.
    const fit = clean.slice(-Math.max(MIN_POINTS, fitWindow));

    const factors = seasonalFactors(fit);
    const deseasoned = fit.map(p => {
      const f = factors[dow(p.date) ?? 0] || 1;
      return p.value / f;
    });

    const slope = theilSen(deseasoned);

    // Level is anchored on the last 14 deseasoned days, back-projected to
    // the final index. Using the last single point instead would hand the
    // whole horizon to one noisy day.
    const tailN = Math.min(14, deseasoned.length);
    const tail = deseasoned.slice(-tailN);
    const tailMid = (tailN - 1) / 2;
    const tailMean = tail.reduce((s, v) => s + v, 0) / tailN;
    const level = tailMean + slope * (tailN - 1 - tailMid);

    // In-sample residuals against the same model, so the band reflects how
    // well this model actually fits THIS series rather than a constant.
    const lastIdx = deseasoned.length - 1;
    let ss = 0;
    for (let i = 0; i < deseasoned.length; i++) {
      const fitted = level + slope * (i - lastIdx);
      const r = deseasoned[i] - fitted;
      ss += r * r;
    }
    const sigma = Math.sqrt(ss / Math.max(1, deseasoned.length - 2));

    // Trailing silence. A series whose last fortnight is all zeros will
    // forecast ~zero, which is arithmetically right and operationally
    // misleading — it usually means the data stopped, not that the business
    // did. The caller gets the count so the UI can say which it is.
    let staleDays = 0;
    for (let i = clean.length - 1; i >= 0 && clean[i].value === 0; i--) staleDays += 1;

    const lastDate = fit[fit.length - 1].date;
    const maxH = Math.max(1, ...horizons.filter(h => Number.isFinite(h) && h > 0));

    const round = (v) => (integer ? Math.round(v) : Math.round(v * 1000) / 1000);
    const floorAt0 = (v) => (clampAtZero ? Math.max(0, v) : v);

    const points = [];
    let cumulativeDrift = 0;
    for (let h = 1; h <= maxH; h++) {
      // Damped additive trend: each further day contributes phi^h of the
      // fitted slope, so growth flattens instead of compounding.
      cumulativeDrift += slope * Math.pow(DAMPING, h);
      const date = addDays(lastDate, h);
      const f = factors[dow(date) ?? 0] || 1;
      const centre = (level + cumulativeDrift) * f;
      // Band widens with √h — the standard random-walk widening, and the
      // reason a 90-day number is visibly less certain than a 30-day one.
      const spread = Z_80 * sigma * Math.sqrt(h) * f;
      points.push({
        date,
        forecast: round(floorAt0(centre)),
        lower: round(floorAt0(centre - spread)),
        upper: round(floorAt0(centre + spread)),
      });
    }

    const totals = {};
    for (const h of horizons) {
      if (!Number.isFinite(h) || h <= 0) continue;
      const slice = points.slice(0, h);
      const sum = (key) => slice.reduce((s, p) => s + p[key], 0);
      totals[h] = {
        horizon: h,
        from: slice[0]?.date ?? null,
        to: slice[slice.length - 1]?.date ?? null,
        total: round(sum('forecast')),
        lower: round(sum('lower')),
        upper: round(sum('upper')),
        dailyAvg: slice.length ? round(sum('forecast') / slice.length) : 0,
      };
    }

    return {
      ok: true,
      reason: null,
      lastActualDate: lastDate,
      points,
      totals,
      quality: {
        observations: clean.length,
        fittedOn: fit.length,
        staleDays,
        lastNonZeroDate: staleDays < clean.length ? clean[clean.length - 1 - staleDays].date : null,
        slopePerDay: Math.round(slope * 1000) / 1000,
        level: Math.round(level * 1000) / 1000,
        sigma: Math.round(sigma * 1000) / 1000,
        seasonal: factors.map(f => Math.round(f * 100) / 100),
      },
    };
  } catch (err) {
    // A forecast failure is never allowed to take a dashboard down; the
    // caller renders `reason` in place of the chart.
    console.warn('[forecast] failed', err?.message ?? err);
    return empty('Forecast could not be computed for this series.');
  }
}

// Convenience for charts: history and forecast on ONE array so a single
// <LineChart> can draw both without a join in the component. Actual and
// forecast are separate keys so Recharts breaks the line at the boundary
// rather than implying the projection is observed data.
export function mergeForChart(history, forecast, { tailDays = 60 } = {}) {
  const hist = (Array.isArray(history) ? history : []).slice(-Math.max(0, tailDays));
  const rows = hist.map(p => ({ date: p.date, actual: p.value }));
  const fc = forecast?.ok ? forecast.points : [];
  if (rows.length && fc.length) {
    // Anchor the forecast line on the last actual point so the two segments
    // visually connect instead of starting a day adrift.
    const last = rows[rows.length - 1];
    last.forecast = last.actual;
    last.lower = last.actual;
    last.upper = last.actual;
  }
  for (const p of fc) {
    rows.push({ date: p.date, forecast: p.forecast, lower: p.lower, upper: p.upper });
  }
  // Recharts draws a ranged <Area> from a two-element array value, so the
  // band is precomputed here rather than with an inline dataKey function
  // (which would re-allocate on every render pass).
  for (const r of rows) {
    r.band = r.lower == null || r.upper == null ? null : [r.lower, r.upper];
  }
  return rows;
}
