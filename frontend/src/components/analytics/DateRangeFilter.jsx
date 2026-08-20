// The Analytics date-range filter.
//
// One control, shared by every section: the page owns a single `range` object
// and hands the resolved edges to all 13 fetchers, so a chart, a KPI tile and
// the sentence underneath them can never be describing different periods.
//
// Purely presentational — it renders the presets from lib/dateRange.js and
// reports a new range object upward. Resolution, clamping and repair all live
// in that module so this file has no date arithmetic of its own to get wrong.

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';
import { RANGE_PRESETS, resolveRange, DEFAULT_RANGE } from '../../lib/dateRange';

export default function DateRangeFilter({ range, onChange, disabled, triggerClassName }) {
  const [open, setOpen] = useState(false);
  // Whether the custom editor is showing. Tracked locally rather than inferred
  // from the applied range: choosing "Custom…" used to commit a range
  // immediately, which refetched all 13 sections before the user had entered a
  // single date, and made the editor impossible to open at all if a parent
  // chose not to accept that intermediate value. Nothing is applied until
  // Apply.
  const [customOpen, setCustomOpen] = useState(false);
  const rootRef = useRef(null);
  // `resolveRange` repairs bad input rather than throwing, but this component
  // renders on every paint of the Analytics page and a raise here would take
  // the whole page down with it. Belt and braces.
  let resolved;
  try {
    resolved = resolveRange(range);
  } catch (err) {
    console.warn('[DateRangeFilter] could not resolve range', err?.message ?? err);
    resolved = resolveRange(DEFAULT_RANGE);
  }

  // Draft custom edges, so a half-typed range does not refetch every section
  // on each keystroke — it is applied only on Apply.
  const [draftFrom, setDraftFrom] = useState(resolved.fromDate);
  const [draftTo, setDraftTo] = useState(resolved.toDate);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Closing the popover abandons an unapplied custom edit, so reopening it
  // shows the range that is actually in force.
  useEffect(() => {
    if (!open) setCustomOpen(false);
  }, [open]);

  const pick = (preset) => {
    if (preset === 'custom') {
      // Seed the inputs from whatever is showing, so the editor starts from
      // the period the user is already looking at rather than blank fields.
      setDraftFrom(resolved.fromDate);
      setDraftTo(resolved.toDate);
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange?.({ preset });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    onChange?.({ preset: 'custom', from: draftFrom, to: draftTo });
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Analytics period: ${resolved.label}`}
        className={clsx(
          'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors',
          // Default is the light-card look; the page header overrides it to
          // sit on the red gradient without restyling the popover.
          triggerClassName
            || 'bg-white border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-700',
          disabled && 'opacity-50 pointer-events-none',
        )}
      >
        <Calendar size={12} className="shrink-0" />
        <span className="truncate max-w-[110px] sm:max-w-[160px]">{resolved.chipLabel}</span>
        <ChevronDown size={11} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select analytics period"
          /* Right-aligned so it opens inward from the header's right edge, and
             width-capped to the viewport so it can never push a horizontal
             scrollbar on a narrow screen. `z-50` clears the chat card below,
             which is `relative` and paints later in DOM order. */
          className="absolute left-0 sm:left-auto sm:right-0 z-50 mt-1 w-[min(16rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 space-y-0.5 text-slate-700"
        >
          {RANGE_PRESETS.map(p => {
            const active = p.key === 'custom'
              ? (customOpen || resolved.preset === 'custom')
              : (resolved.preset === p.key && !customOpen);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p.key)}
                className={clsx(
                  'w-full flex items-center justify-between gap-2 text-left text-[11px] px-2.5 py-1.5 rounded-lg transition-colors',
                  active
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <span>{p.label}</span>
                {active && <Check size={11} className="shrink-0" />}
              </button>
            );
          })}

          {(customOpen || resolved.preset === 'custom') && (
            <div className="pt-1.5 mt-1 border-t border-slate-100 px-1.5 pb-1 space-y-1.5">
              {/* No `min`/`max` coupling between the two inputs. Constraining
                  From by To meant the pair could only ever be moved in one
                  order — to shift the window later you had to edit To first,
                  and picking a From past the current To was simply refused
                  with no feedback. A reversed pair is repaired by
                  `resolveRange` instead, and the hint below says so. */}
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">From</span>
                <input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="mt-0.5 w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:border-primary-300"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">To</span>
                <input
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="mt-0.5 w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:border-primary-300"
                />
              </label>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draftFrom || !draftTo}
                className="w-full text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                Apply
              </button>
              {/* Historical data is the point of this control: the ERP is still
                  being built, so the newest records may be months old and a
                  rolling window would return nothing. */}
              <p className="text-[10px] text-slate-400 leading-snug">
                Any past period works — analytics read whatever is in the
                database for the dates you choose. Dates in either order are
                fine.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
