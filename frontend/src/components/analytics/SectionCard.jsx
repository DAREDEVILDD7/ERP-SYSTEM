// Common wrapper for every analytics section: title, subtitle, loading /
// error / empty states, and a refresh button. Delegates the actual chart
// and KPI rendering to a `render(data)` prop.

import { AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import ClaudeTypingLoader, { useMinDurationGate } from './ClaudeTypingLoader';

export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  isLoading,
  isRefetching,
  error,
  data,
  onRefresh,
  hasData, // caller-provided predicate; defaults to !!data
  emptyMessage = 'Insufficient data for this window.',
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

  return (
    <section
      className={clsx(
        'neo-card p-5 flex flex-col gap-4 min-h-[240px]',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            {Icon && <Icon size={15} className="text-primary-500 shrink-0" />}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={showLoader || isRefetching}
          title="Refresh"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* `relative` is load-bearing: ClaudeTypingLoader positions itself
          absolutely over this area so that neither its arrival nor its
          fade-out can shift the card's layout. The results are mounted the
          instant loading ends and cross-fade in underneath the departing
          loader. */}
      <div className="flex-1 min-h-0 relative">
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
