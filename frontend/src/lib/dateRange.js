// The Analytics date-range filter's model. Pure, so the presets, the
// resolution and the labelling can be reasoned about (and tested) without a
// React tree, and so the page, the chips and the API layer all read one
// definition instead of three.
//
// A range is a small serialisable object — `{ preset }` or
// `{ preset: 'custom', from, to }` — because it lives in component state, is
// part of every React Query key, and is printed into the chat transcript.
// Keeping it serialisable is what lets the query cache treat two identical
// ranges as the same entry instead of refetching on every render.
//
// `resolveRange` turns that into the concrete `{ from, to, days }` the
// fetchers want. Everything is clamped and repaired rather than thrown on: a
// date filter that can raise takes all 13 sections down with it, and there is
// no user input here worth that risk.

const DAY_MS = 86_400_000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// `YYYY-MM-DD`, in LOCAL time. `toISOString().slice(0,10)` is a real trap
// here: it converts to UTC first, so for anyone east of Greenwich a date
// picked as the 1st is sent as the previous month's last day.
export function toDateInput(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

function parseDateInput(v) {
  if (!v) return null;
  const d = v instanceof Date ? new Date(v) : new Date(`${v}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

// The catalogue the picker renders. `days` is present only for the rolling
// presets; the calendar presets compute their own edges, which is the whole
// reason they cannot be expressed as a day count.
export const RANGE_PRESETS = [
  { key: 'last_7',     label: 'Last 7 days',   days: 7   },
  { key: 'last_30',    label: 'Last 30 days',  days: 30  },
  { key: 'last_90',    label: 'Last 90 days',  days: 90  },
  { key: 'this_month', label: 'This month'               },
  { key: 'last_month', label: 'Last month'               },
  { key: 'all_time',   label: 'All time'                 },
  { key: 'custom',     label: 'Custom…'                  },
];

// The lower edge for "All time". A fixed floor rather than a probe for the
// oldest row: the range has to resolve synchronously for thirteen sections
// that each query different tables, and no ERP record predates this.
const ALL_TIME_FROM = new Date(2000, 0, 1);

export const DEFAULT_RANGE = { preset: 'last_90' };

export function isCustom(range) {
  return range?.preset === 'custom';
}

// Resolve a range object into concrete edges.
//
// Returns `{ from, to, fromDate, toDate, days, label, preset, explicit }`.
// `explicit` marks a range the user actually chose: the page's per-section
// clamps (a 30-day maintenance window shows almost nothing) still apply to the
// default, but must NOT silently rewrite a period the user named and that the
// transcript has already printed.
export function resolveRange(range) {
  const preset = range?.preset ?? DEFAULT_RANGE.preset;
  const now = new Date();
  let from;
  let to = endOfDay(now);
  let label;

  switch (preset) {
    case 'all_time': {
      from = startOfDay(ALL_TIME_FROM);
      label = 'all time';
      break;
    }
    case 'this_month': {
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      label = 'this month';
      break;
    }
    case 'last_month': {
      from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      // Day 0 of this month is the last day of the previous one.
      to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      label = 'last month';
      break;
    }
    case 'custom': {
      let f = parseDateInput(range?.from);
      let t = parseDateInput(range?.to);
      // An incomplete custom range is a half-finished interaction, not an
      // error — fall back to the default span rather than blanking every
      // section while the user is still typing.
      if (!f || !t) {
        const fallback = RANGE_PRESETS.find(p => p.key === DEFAULT_RANGE.preset);
        const d = fallback?.days ?? 90;
        from = startOfDay(new Date(now.getTime() - d * DAY_MS));
        label = `the last ${d} days`;
        break;
      }
      if (f > t) { const tmp = f; f = t; t = tmp; }
      from = startOfDay(f);
      to = endOfDay(t);
      label = `${toDateInput(from)} to ${toDateInput(to)}`;
      break;
    }
    default: {
      const p = RANGE_PRESETS.find(x => x.key === preset);
      const d = p?.days ?? 90;
      from = startOfDay(new Date(now.getTime() - d * DAY_MS));
      label = `the last ${d} days`;
      break;
    }
  }

  // A rolling preset keeps its OWN day count. Deriving it from the span
  // instead would make "Last 90 days" resolve to 91 (start-of-day to
  // end-of-day is 90 days plus the remainder of today), quietly shifting the
  // default window and every baseline computed from it.
  const presetDays = RANGE_PRESETS.find(x => x.key === preset)?.days;
  const days = presetDays
    ?? Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const allTime = preset === 'all_time';
  return {
    preset,
    allTime,
    from: from.toISOString(),
    to: to.toISOString(),
    fromDate: toDateInput(from),
    toDate: toDateInput(to),
    days,
    // `label` is PROSE — it is written into sentences ("compared with the
    // last 90 days"), so it carries a leading article. `chipLabel` is the
    // same period as a NAME, for the filter button and any chip: a button
    // reading "the last 7 days" is the prose form leaking into UI, which is
    // exactly how it shipped. Keep the two separate.
    chipLabel: RANGE_PRESETS.find(x => x.key === preset && x.key !== 'custom')?.label
      ?? (preset === 'custom' ? `${toDateInput(from)} → ${toDateInput(to)}` : label),
    label,
    // The default range keeps the historic per-section clamping; anything the
    // user actively picks is honoured verbatim.
    explicit: preset !== DEFAULT_RANGE.preset || isCustom(range),
  };
}

// The params every windowed section passes to its fetcher. One place, so a
// section cannot accidentally send a range in a shape the API does not read.
export function rangeParams(resolved) {
  if (!resolved) return {};
  return {
    days: resolved.days,
    from: resolved.from,
    to: resolved.to,
    // Carried through so a section can SAY "All time" instead of printing the
    // 2000-01-01 floor, which is an implementation detail rather than a
    // period anyone chose.
    allTime: resolved.allTime || undefined,
  };
}
