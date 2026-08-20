// Common wrapper for every analytics section: title, subtitle, loading /
// error / empty states, and a refresh button. Delegates the actual chart
// and KPI rendering to a `render(data)` prop.

import { useLayoutEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import ClaudeTypingLoader, { useMinDurationGate } from './ClaudeTypingLoader';
import { scheduleChartDrawIn } from './chartAnimation';

export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  isLoading,
  isRefetching,
  error,
  data,
  refetch,
  hasData, // caller-provided predicate; defaults to !!data
  emptyMessage = 'Insufficient data for this window.',
  filter, // optional node (a per-card DateRangeFilter) shown BEFORE Refresh
  resetAction, // optional node (a per-card Reset button) shown AFTER Refresh
  children,
  className,
}) {
  // Each submitted prompt mounts a fresh SectionCard, so a mount-scoped
  // gate is exactly "show the animation on every prompt". ORing it with
  // isLoading gives the required floor without delaying the query, which
  // still fires on mount as before: at least MIN_MS, longer if the data
  // is slower. A cached/instant answer therefore still animates rather
  // than flashing past.
  const withinMinDuration = useMinDurationGate();
  const showLoader = withinMinDuration || !!isLoading;

  // Keyed off showLoader (not isLoading) so a cached-but-empty result can't
  // flash "Insufficient data" underneath the animation during the gate.
  const showEmpty =
    !showLoader && !error && (hasData ? !hasData(data) : !data);

  // Draw every chart in this card on, ONCE, at the moment the body actually
  // becomes visible. This has to be keyed off `showLoader` rather than off
  // the data arriving: the mascot loader keeps `children` UNMOUNTED for a
  // minimum of 3 seconds, so a chart is not in the DOM to animate — and the
  // user cannot see anything — until it clears. Doing it here also means
  // every section's charts are covered without per-chart wiring; a chart
  // that must additionally REPLAY on drill-down wraps itself in `ChartAnim`,
  // which marks its subtree so this sweep skips it.
  const bodyRef = useRef(null);
  useLayoutEffect(() => {
    if (showLoader) return undefined;
    return scheduleChartDrawIn(() => bodyRef.current, { skipOwned: true });
  }, [showLoader]);

  return (
    <section
      className={clsx(
        'neo-card p-3 sm:p-5 flex flex-col gap-4 min-h-[240px] min-w-0 max-w-full',
        className,
      )}
    >
      {/* `overflow-hidden` lives here, on the header, NOT on the section —
          the per-card DateRangeFilter's popover is `absolute` inside this
          header and a card-level overflow-hidden would clip it at the card's
          edge. Same trap already documented for the page-level header; the
          fix is the same: scope the clip to what actually needs it. */}
      <header className="relative flex items-start justify-between gap-3 overflow-visible">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            {Icon && <Icon size={15} className="text-primary-500 shrink-0" />}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {filter}
          <button
            onClick={refetch}
            disabled={showLoader || isRefetching}
            title="Refresh"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:scale-90 transition-all disabled:opacity-40"
          >
            <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} />
          </button>
          {resetAction}
        </div>
      </header>

      {/* Refetch indicator — a thin animated bar at the top edge of the
          card body that appears ONLY when the section is refetching
          (not on initial load, since the mascot loader owns that phase
          and is a frozen invariant). Refetches happen when the user
          changes the date filter or hits Refresh, so this gives a
          non-jarring visual cue that data is being updated without
          wiping the existing values below. */}
      {isRefetching && !showLoader && (
        <div
          className="h-0.5 -mt-2 rounded-full bg-primary-100 overflow-hidden"
          role="status"
          aria-label="Refreshing section data"
        >
          <div className="h-full w-1/3 bg-primary-500 animate-[shimmer_1.2s_ease-in-out_infinite]" />
          <style>{`
            @keyframes shimmer {
              0%   { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
          `}</style>
        </div>
      )}

      {/* `relative` is load-bearing: ClaudeTypingLoader positions itself
          absolutely over this area so that neither its arrival nor its
          fade-out can shift the card's layout. The results are mounted the
          instant loading ends and cross-fade in underneath the departing
          loader. `overflow-hidden` moved here from the outer `<section>` —
          this is the area that actually needs clipping (the loader artwork,
          chart overflow); the header above must stay unclipped so the
          per-card date filter's popover isn't cut off at the card edge. */}
      <div ref={bodyRef} className="flex-1 min-h-0 relative overflow-hidden">
        {/* Nothing is rendered beneath the animation while it runs — not even
            an error or empty state — so the reveal is always a single clean
            cross-fade rather than content appearing behind the artwork. */}
        {!showLoader &&
          (error ? (
            <div className="flex flex-col items-center gap-2 text-xs text-amber-600 py-8">
              <AlertTriangle size={20} />
              <p>Could not load section</p>
              <p className="text-slate-400">{String(error?.message ?? error)}</p>
            </div>
          ) : showEmpty ? (
            <div className="flex flex-col items-center gap-1 text-xs text-slate-400 py-8">
              <p className="font-medium text-slate-500">Insufficient data</p>
              <p>{emptyMessage}</p>
            </div>
          ) : (
            children
          ))}

        <ClaudeTypingLoader visible={showLoader} message="Generating AI insights" />
      </div>
    </section>
  );
}
