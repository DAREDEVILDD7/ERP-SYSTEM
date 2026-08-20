// Renders the seven-field analyst brief produced by lib/insightBrief.js.
//
// Sits ABOVE the existing InsightList in every section: the brief is the
// summary a human analyst would open with, the bullet list underneath is the
// detail. Neither replaces the other and the list is unchanged.
//
// Fields that could not be derived are omitted rather than rendered empty —
// a brief claiming "Root cause: —" reads worse than one that simply does not
// mention root cause.

import clsx from 'clsx';
import {
  TrendingUp, Crown, Search, ShieldAlert, CheckCircle2, Gauge,
} from 'lucide-react';

const RISK_TOKENS = {
  Low:      { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  Elevated: { chip: 'bg-amber-50 text-amber-800 border-amber-200',       dot: 'bg-amber-500'   },
  High:     { chip: 'bg-primary-50 text-primary-700 border-primary-200', dot: 'bg-primary-500' },
};

const CONFIDENCE_TOKENS = {
  High:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  Medium: 'bg-slate-100 text-slate-600 border-slate-200',
  Low:    'bg-amber-50 text-amber-800 border-amber-200',
};

function Row({ icon: Icon, label, children }) {
  if (!children) return null;
  return (
    <div className="flex gap-2.5 min-w-0">
      <Icon size={13} className="text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 leading-tight">{label}</p>
        <div className="text-xs text-slate-700 leading-relaxed break-words">{children}</div>
      </div>
    </div>
  );
}

export default function AnalysisBrief({ brief }) {
  if (!brief?.keyFinding) return null;

  const risk = RISK_TOKENS[brief.riskLevel] ?? RISK_TOKENS.Low;
  const conf = CONFIDENCE_TOKENS[brief.confidence?.level] ?? CONFIDENCE_TOKENS.Medium;

  return (
    <section
      className="neo-inset rounded-xl p-3.5 space-y-3"
      aria-label="Analysis summary"
    >
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
          Analyst brief
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border',
              risk.chip,
            )}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', risk.dot)} aria-hidden="true" />
            {brief.riskLevel} risk
          </span>
          {brief.confidence?.level && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border',
                conf,
              )}
              title={brief.confidence.reason}
            >
              <Gauge size={9} aria-hidden="true" />
              {brief.confidence.level} confidence
            </span>
          )}
        </div>
      </header>

      <p className="text-sm text-slate-800 font-medium leading-snug">
        {brief.keyFinding}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-2.5">
        <Row icon={TrendingUp} label="Trend">{brief.trend}</Row>
        <Row icon={Crown} label="Top contributor">
          {brief.topContributor && (
            <>
              <span className="font-semibold text-slate-800">{brief.topContributor.label}</span>
              {brief.topContributor.detail && (
                <span className="text-slate-500"> — {brief.topContributor.detail}</span>
              )}
              {/* Identifier lives here, as hover detail only. */}
              {brief.topContributor.meta && (
                <span
                  className="ml-1 text-[10px] text-slate-300 cursor-help"
                  title={brief.topContributor.meta}
                >
                  ⓘ
                </span>
              )}
            </>
          )}
        </Row>
        <Row icon={Search} label="Likely cause">{brief.rootCause}</Row>
        <Row icon={CheckCircle2} label="Recommended action">{brief.recommendedAction}</Row>
      </div>

      {brief.confidence?.reason && (
        <p className="text-[10px] text-slate-400 leading-relaxed flex items-start gap-1.5 pt-0.5 border-t border-slate-200/70">
          <ShieldAlert size={10} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{brief.confidence.reason}</span>
        </p>
      )}
    </section>
  );
}
