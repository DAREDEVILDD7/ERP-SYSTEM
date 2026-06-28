import clsx from 'clsx';

/**
 * Sk — base shimmer block. Uses the global `.sk` CSS class from index.css.
 * Use className for border-radius / size via Tailwind, or style for precise px widths.
 */
export function Sk({ className = '', style }) {
  return <div className={clsx('sk', className)} style={style} />;
}

/**
 * SkeletonTable — full card-wrapped table skeleton.
 *
 * Props:
 *   rows       number   how many body rows to render (default 8)
 *   colWidths  number[] pixel widths for each column (drives proportional placeholders)
 *   hasAvatar  bool     first column shows a circle + text (e.g. user/customer name)
 *   className  string   extra classes on the outer card wrapper
 */
export function SkeletonTable({ rows = 8, colWidths, hasAvatar = false, className = '' }) {
  const cols = colWidths ?? [90, 130, 110, 90, 80, 100, 75, 70];

  return (
    <div className={clsx('card overflow-hidden', className)}>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {cols.map((w, i) => (
                <th key={i} className="px-4 py-3 text-left">
                  <Sk style={{ width: Math.round(w * 0.7), height: 10 }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {Array.from({ length: rows }).map((_, ri) => (
              <tr key={ri}>
                {cols.map((w, ci) => (
                  <td key={ci} className="px-4 py-3.5">
                    {ci === 0 && hasAvatar ? (
                      <div className="flex items-center gap-2">
                        <Sk className="rounded-full shrink-0" style={{ width: 32, height: 32 }} />
                        <Sk style={{ height: 12, width: Math.max(40, w - 44) }} />
                      </div>
                    ) : ci === cols.length - 1 ? (
                      <div className="flex gap-1.5">
                        <Sk className="rounded-lg" style={{ height: 26, width: 52 }} />
                        <Sk className="rounded-lg" style={{ height: 26, width: 44 }} />
                      </div>
                    ) : (
                      <Sk style={{ height: 12, width: Math.round(w * (0.55 + ((ri + ci) % 3) * 0.15)) }} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y divide-gray-100">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <Sk style={{ height: 14, width: 120 + (i % 3) * 20 }} />
                <Sk style={{ height: 11, width: 160 + (i % 2) * 30 }} />
              </div>
              <Sk className="rounded-full shrink-0" style={{ height: 20, width: 64 }} />
            </div>
            <Sk style={{ height: 11, width: 140 + (i % 2) * 20 }} />
            <div className="flex gap-2 pt-1">
              <Sk className="rounded-lg" style={{ height: 28, width: 72 }} />
              <Sk className="rounded-lg" style={{ height: 28, width: 60 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SkeletonStatCards — a row of KPI card skeletons.
 * count: number of cards (default 4)
 */
export function SkeletonStatCards({ count = 4, className = '' }) {
  return (
    <div className={clsx('grid grid-cols-2 lg:grid-cols-4 gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 flex items-center justify-between gap-2">
          <div className="space-y-2">
            <Sk style={{ height: 11, width: 80 + (i % 3) * 20 }} />
            <Sk style={{ height: 32, width: 48 }} />
          </div>
          <Sk className="rounded-xl shrink-0" style={{ width: 44, height: 44 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * SkeletonDashboard — full dashboard page skeleton.
 * Renders: stat row + chart/list grid (matching typical dashboard layout).
 */
export function SkeletonDashboard({ statCount = 4, className = '' }) {
  return (
    <div className={clsx('space-y-4', className)}>
      {/* Stat cards */}
      <SkeletonStatCards count={statCount} />

      {/* Charts / feed row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 space-y-3 lg:col-span-1">
          <Sk style={{ height: 14, width: 120 }} />
          <Sk className="rounded-full mx-auto" style={{ width: 160, height: 160 }} />
          <div className="space-y-2 pt-2">
            {[80, 100, 90, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Sk className="rounded-full shrink-0" style={{ width: 10, height: 10 }} />
                <Sk style={{ height: 10, width: w }} />
                <Sk className="ml-auto" style={{ height: 10, width: 40 }} />
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5 space-y-3 lg:col-span-2">
          <Sk style={{ height: 14, width: 160 }} />
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="py-3 flex items-center gap-3">
                <Sk className="rounded-lg shrink-0" style={{ width: 36, height: 36 }} />
                <div className="flex-1 space-y-1.5">
                  <Sk style={{ height: 12, width: 120 + (i % 3) * 20 }} />
                  <Sk style={{ height: 10, width: 80 + (i % 2) * 30 }} />
                </div>
                <Sk className="rounded-full shrink-0" style={{ width: 60, height: 18 }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Third row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="card p-5 space-y-3">
            <Sk style={{ height: 14, width: 140 + i * 20 }} />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 py-1.5">
                  <Sk style={{ height: 11, width: 50 }} />
                  <Sk className="flex-1" style={{ height: 11 }} />
                  <Sk style={{ height: 11, width: 60 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SkeletonChatThreads — sidebar thread list skeleton.
 */
export function SkeletonChatThreads({ count = 7, className = '' }) {
  return (
    <div className={clsx('divide-y divide-gray-50', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-4 py-3 space-y-1.5">
          <Sk style={{ height: 13, width: 100 + (i % 3) * 28 }} />
          <Sk style={{ height: 10, width: 155 + (i % 2) * 24 }} />
          <Sk style={{ height: 9,  width: 72 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * SkeletonChatMessages — alternating message bubble skeletons.
 */
export function SkeletonChatMessages({ count = 7, className = '' }) {
  // Alternate: mostly left (other) with some right (me)
  const sides = [false, false, true, false, false, true, false, false, true];
  return (
    <div className={clsx('space-y-4', className)}>
      {Array.from({ length: count }).map((_, i) => {
        const isMe = sides[i % sides.length];
        const w = 100 + ((i * 47) % 160);
        const h = 34 + ((i * 31) % 32);
        return (
          <div key={i} className={clsx('flex flex-col', isMe ? 'items-end' : 'items-start')}>
            <Sk
              style={{
                height: h,
                width: w,
                borderRadius: isMe
                  ? '16px 4px 16px 16px'
                  : '4px 16px 16px 16px',
                background: isMe
                  ? 'linear-gradient(90deg, #c7d2fe 25%, #dde6ff 50%, #c7d2fe 75%)'
                  : undefined,
                backgroundSize: '1200px 100%',
              }}
            />
            <Sk className="mt-1" style={{ height: 8, width: 90 + (i % 2) * 20 }} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * SkeletonPreviewCard — skeleton for quotation / requirement preview modals.
 */
export function SkeletonPreviewCard({ className = '' }) {
  return (
    <div className={clsx('p-5 space-y-4', className)}>
      {/* Status badge */}
      <Sk className="rounded-full" style={{ height: 22, width: 80 }} />
      {/* 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        {[100, 90, 80, 110].map((w, i) => (
          <div key={i} className="space-y-1">
            <Sk style={{ height: 9,  width: 55 }} />
            <Sk style={{ height: 13, width: w }} />
          </div>
        ))}
      </div>
      {/* Amount / summary box */}
      <div className="rounded-xl bg-gray-50 p-3 flex items-center justify-between">
        <Sk style={{ height: 10, width: 70 }} />
        <Sk style={{ height: 20, width: 80 }} />
      </div>
    </div>
  );
}

/**
 * SkeletonCards — a vertical stack of mobile-style card skeletons.
 * Useful when a page only has card layout (no table).
 */
export function SkeletonCards({ count = 5, className = '' }) {
  return (
    <div className={clsx('card overflow-hidden divide-y divide-gray-100', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 flex gap-3">
          <Sk className="rounded-xl shrink-0" style={{ width: 48, height: 48 }} />
          <div className="flex-1 space-y-2">
            <Sk style={{ height: 14, width: 130 + (i % 3) * 20 }} />
            <Sk style={{ height: 11, width: 180 + (i % 2) * 20 }} />
            <Sk style={{ height: 11, width: 140 }} />
          </div>
          <Sk className="rounded-full shrink-0" style={{ width: 60, height: 20 }} />
        </div>
      ))}
    </div>
  );
}
