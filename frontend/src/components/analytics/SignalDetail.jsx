// SignalDetail — what a priority signal actually means, rendered into the
// analytics chat when a ribbon chip is clicked.
//
// Why this exists: every rule in `lib/anomalyRules.js` carries a `promptId`,
// and a chip click used to open that section prompt. Eight of the fifteen
// rules point at `top_customers` — including all four data-quality rules,
// because they are computed inside `getTopCustomers` — so clicking
// "2 anomalous quotes detected" asked "who are our top customers by billing?"
// and never answered the question the chip had raised. The chip already held
// a real explanation in `headline`/`detail`; the strip truncated it and the
// click threw it away.
//
// This component renders the `explain` block instead: what the signal
// detects, why it fired, how it is measured, the rows responsible, and what
// to do about it. The old section prompt survives as a follow-up chip, which
// AnalyticsPage builds from `explain.related` — so the previous destination
// is one click away rather than the only destination.
//
// Everything here degrades rather than fails:
//   * No `explain` at all → headline + detail, which every rule always has.
//   * `explain` present but a section missing → that section is skipped, no
//     empty heading is left behind.
//   * A record list of any length → capped at MAX_ROWS with a "+N more" note,
//     so a 25-row flag cannot blow the transcript open.
//   * A render throw → caught by the boundary below, which falls back to the
//     same headline + detail. The chat around it keeps working.
//
// No data fetching. Every number arrives on the anomaly object, which the
// ribbon already computed from payloads it had already fetched.

import { Component } from 'react';
import { AlertTriangle, Info, CheckCircle2, ListChecks } from 'lucide-react';

// Enough rows to make the signal actionable without turning a chat bubble
// into a data grid. The API already caps `dataQualityFlags` at 25.
const MAX_ROWS = 8;

const SEV = {
  critical: { label: 'Critical', pill: 'bg-red-100 text-red-700',      bar: 'bg-red-500',     Icon: AlertTriangle },
  warning:  { label: 'Watch',    pill: 'bg-amber-100 text-amber-700',  bar: 'bg-amber-500',   Icon: AlertTriangle },
  info:     { label: 'Note',     pill: 'bg-sky-100 text-sky-700',      bar: 'bg-sky-500',     Icon: Info },
  positive: { label: 'Good',     pill: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', Icon: CheckCircle2 },
};

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// Values arrive raw from the screening rows so the renderer can tell "no
// value on this row" (undefined) from a real 0 or a real negative — both of
// which are exactly what several of these signals are about.
function fmtValue(v) {
  if (v === undefined || v === null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v).slice(0, 24);
  return `KWD ${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
}

// ISO day → "21 Mar". Anything unparseable is shown as-is rather than
// swallowed, because a malformed date is itself one of the flagged states.
function fmtDay(d) {
  const s = str(d);
  if (!s) return '—';
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return s.slice(0, 10);
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function Section({ title, children }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Metrics({ items }) {
  if (!items.length) return null;
  return (
    <Section title="The numbers">
      {/* One column on phones so long labels never collide with values, two
          from sm, three only from xl. The chat is `flex-1` beside the section
          column, so at lg it is roughly half the viewport — three tiles there
          would be ~160px each. Breakpoints are viewport-wide, not
          container-wide, so this has to be judged against that layout. */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
        {items.map((m, i) => (
          <div
            key={`${m.label}-${i}`}
            className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 min-w-0"
          >
            <dt className="text-[10px] text-slate-500 truncate" title={m.label}>
              {m.label}
            </dt>
            <dd className="text-[13px] font-semibold text-slate-800 truncate" title={String(m.value)}>
              {m.value}
            </dd>
            {str(m.hint) && (
              <dd className="text-[9px] text-slate-400 leading-tight mt-0.5">{m.hint}</dd>
            )}
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Records({ block }) {
  const rows = list(block?.rows);
  if (!rows.length) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <Section title={`${str(block?.title) ?? 'Affected records'} (${rows.length})`}>
      {/* The table scrolls inside its own container. The chat column is
          narrow and these ids are long; letting the bubble itself scroll
          sideways would drag the whole transcript with it. */}
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="text-left font-medium px-2 py-1 whitespace-nowrap">Reference</th>
              <th className="text-left font-medium px-2 py-1 whitespace-nowrap">Date</th>
              <th className="text-left font-medium px-2 py-1">Customer</th>
              <th className="text-right font-medium px-2 py-1 whitespace-nowrap">Value</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.id}-${i}`} className="border-t border-slate-100 align-top">
                <td
                  className="px-2 py-1 font-mono text-[10px] text-slate-700 whitespace-nowrap"
                  title={str(r.note) ?? undefined}
                >
                  {str(r.id) ?? '—'}
                </td>
                <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{fmtDay(r.date)}</td>
                {/* Names in the UI, identifiers on hover — the convention the
                    rest of Analytics follows. */}
                <td className="px-2 py-1 text-slate-700 max-w-[160px] truncate" title={str(r.label) ?? undefined}>
                  {str(r.label) ?? '—'}
                </td>
                <td className="px-2 py-1 text-right text-slate-700 whitespace-nowrap tabular-nums">
                  {fmtValue(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <p className="text-[10px] text-slate-400 mt-1">
          + {hidden} more not shown — open the module to see the full list.
        </p>
      )}
    </Section>
  );
}

function Body({ anomaly }) {
  const sev = SEV[anomaly?.severity] ?? SEV.info;
  const { Icon } = sev;
  const ex = anomaly?.explain ?? {};

  const what    = str(ex.what);
  const why     = str(ex.why) ?? str(anomaly?.detail);
  const basis   = str(ex.basis);
  const metrics = list(ex.metrics);
  const actions = list(ex.actions).map(str).filter(Boolean);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Heading — restates the signal in full. The ribbon truncates it to
          fit five chips on screen; here there is room for the whole thing. */}
      <div className="flex items-start gap-2 min-w-0">
        <span className={`mt-0.5 w-1 self-stretch rounded-full shrink-0 ${sev.bar}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Icon size={12} className="text-slate-400 shrink-0" />
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${sev.pill}`}>
              {sev.label}
            </span>
          </div>
          <p className="text-[13px] font-semibold text-slate-800 mt-1 break-words">
            {str(anomaly?.headline) ?? 'Priority signal'}
          </p>
        </div>
      </div>

      {what && (
        <Section title="What this signal is">
          <p className="text-[12px] text-slate-600 leading-relaxed">{what}</p>
        </Section>
      )}

      {why && (
        <Section title="Why it fired">
          <p className="text-[12px] text-slate-600 leading-relaxed">{why}</p>
        </Section>
      )}

      <Metrics items={metrics} />

      <Records block={ex.records} />

      {basis && (
        <Section title="How it is measured">
          <p className="text-[11px] text-slate-500 leading-relaxed">{basis}</p>
        </Section>
      )}

      {actions.length > 0 && (
        <Section title="What to do">
          <ul className="flex flex-col gap-1">
            {actions.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-600 leading-relaxed">
                <ListChecks size={11} className="mt-[3px] text-slate-400 shrink-0" />
                <span className="min-w-0">{a}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// A broken explainer must not take the transcript with it. The fallback is
// the headline and detail the anomaly always carries — which is strictly
// more than the chip showed before this component existed.
class DetailBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[SignalDetail] render failed:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      const a = this.props.anomaly ?? {};
      return (
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-800 break-words">
            {str(a.headline) ?? 'Priority signal'}
          </p>
          {str(a.detail) && (
            <p className="text-[12px] text-slate-600 leading-relaxed">{a.detail}</p>
          )}
          <p className="text-[10px] text-slate-400">
            The full breakdown could not be rendered.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SignalDetail({ anomaly }) {
  // Defensive: the anomaly is snapshotted into the transcript, so a stale
  // session restored from sessionStorage could in principle hand us
  // anything. Never render an empty bubble.
  if (!anomaly || typeof anomaly !== 'object') {
    return (
      <p className="text-[12px] text-slate-500">
        This signal is no longer available — it may have cleared since it was opened.
      </p>
    );
  }
  return (
    <DetailBoundary anomaly={anomaly}>
      <Body anomaly={anomaly} />
    </DetailBoundary>
  );
}
