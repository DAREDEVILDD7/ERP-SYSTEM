// Chart draw-on animation for the Analytics surface.
//
// Animates the RENDERED SVG ELEMENTS Recharts produces, via the Web
// Animations API — NOT a progress number fed back through React, and NOT
// Recharts' own `isAnimationActive`.
//
// Why this way, after several approaches that did not visibly play:
//   * Recharts' built-in animation keys off `useAnimationId`, an internal
//     reference-equality check we cannot drive from outside; it did not
//     reliably re-fire for our data changes.
//   * An overlay <rect> "mask" child depends on Recharts choosing to render
//     an arbitrary child ABOVE the series in SVG paint order. SVG paints in
//     document order and Recharts owns that order, so the mask could sit
//     UNDER the line and do nothing at all.
//   * Re-rendering a progress value through React 60x/second fights
//     Recharts' reconciliation and re-runs every section's render.
//
// Animating the real DOM nodes sidesteps all of it. These class names are
// stable, documented parts of Recharts' rendered output:
//   `.recharts-line-curve` / `.recharts-area-curve` — the stroked path
//   `.recharts-area-area`                          — the area fill
//   `.recharts-bar-rectangle`                      — one group per bar
//
// Techniques, per shape:
//   LINE / AREA STROKE — a true path draw: stroke-dasharray + dashoffset
//     measured with getTotalLength() and animated to 0, so the stroke is
//     literally drawn on from its start (left → right for time-ordered
//     series).
//   AREA FILL — clip-path inset() wiped left → right, so the fill follows
//     its stroke without distorting the shape.
//   BARS — scaleY (or scaleX for horizontal layouts) from the baseline,
//     with transform-box: fill-box so each bar grows out of the axis.

export const CHART_ANIM_MS = 650;
export const CHART_ANIM_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Marks a subtree that runs its OWN animation (a zoomable chart, which must
// replay on every drill-down). The card-level sweep skips these so a chart
// can never be animated twice at once.
export const OWN_ANIM_ATTR = 'data-chart-anim';

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Draws every chart element inside `root` on. Returns a cancel function.
// `skipOwned` excludes subtrees that animate themselves (see OWN_ANIM_ATTR).
//
// Fails soft everywhere: `element.animate` is absent in jsdom and very old
// browsers, and getBBox/getTotalLength throw on detached nodes — in every
// such case the chart simply appears without the flourish rather than
// breaking the page.
// `bars` forces bar orientation: 'vertical' (grow bottom→top, the default
// chart shape) or 'horizontal' (grow from the value axis outward, for
// Recharts' `layout="vertical"`). Omit it to infer from the rendered bar set
// — see the detection note below. Call sites that know their own layout
// should always pass it; inference exists for the card-level sweep, which
// animates charts it did not author.
// `signed` marks a diverging chart whose bars sit on both sides of a zero
// line (negative values), so losses grow out of zero instead of away from
// it. Leave it off for every ordinary and stacked chart — see the anchor
// note below for why it must not be the default.
export function runChartDrawIn(root, { skipOwned = false, bars, signed = false } = {}) {
  const running = [];
  if (!root || prefersReducedMotion()) return () => {};

  const animate = (el, keyframes) => {
    if (!el || typeof el.animate !== 'function') return;
    try {
      running.push(el.animate(keyframes, {
        duration: CHART_ANIM_MS,
        easing: CHART_ANIM_EASING,
        fill: 'backwards',
      }));
    } catch {
      /* animation is decoration — never let it break a render */
    }
  };

  const pick = (selector) => {
    let nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
    if (!skipOwned) return nodes;
    return nodes.filter((n) => {
      try { return !n.closest(`[${OWN_ANIM_ATTR}]`); } catch { return true; }
    });
  };

  try {
    // ── Stroked paths: a genuine left → right draw-on ────────────────────
    pick('.recharts-line-curve, .recharts-area-curve').forEach((path) => {
      let len = 0;
      try {
        len = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0;
      } catch {
        len = 0;
      }
      if (!len) return;
      animate(path, [
        { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
        { strokeDasharray: `${len}`, strokeDashoffset: '0' },
      ]);
    });

    // ── Area fills follow their stroke ───────────────────────────────────
    pick('.recharts-area-area').forEach((fill) => {
      animate(fill, [
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0 0 0)' },
      ]);
    });

    // ── Bars grow out of the baseline ────────────────────────────────────
    //
    // ORIENTATION IS PER CHART, NEVER PER BAR. The previous version asked
    // each bar individually "am I wider than I am tall?" and animated scaleX
    // when so. In a normal VERTICAL bar chart any bar with a small value is
    // exactly that — a short, wide stub — so a category sitting near zero
    // (Buy 0 / Lease 2 beside Other 24) was misread as a horizontal bar and
    // grew left→right while its taller neighbours grew bottom→top. A bar's
    // own aspect ratio simply does not carry its chart's orientation.
    //
    // What DOES carry it, reliably, is the bar set as a whole: a vertical
    // chart gives every bar the same WIDTH and varying heights; a horizontal
    // chart gives every bar the same HEIGHT and varying widths. Counting
    // distinct rounded values on each axis and taking whichever agrees more
    // is correct for grouped and stacked charts too, where the per-bar test
    // fails most often. Call sites that know their layout pass `bars`
    // explicitly and skip the inference entirely.
    const groups = new Map(); // chart wrapper -> bar geometry list
    pick('.recharts-bar-rectangle').forEach((bar) => {
      let box = null;
      try { box = typeof bar.getBBox === 'function' ? bar.getBBox() : null; } catch { /* skip this bar */ }
      if (!box || box.width <= 0 || box.height <= 0) return;
      let chart = null;
      try { chart = bar.closest('.recharts-wrapper') ?? root; } catch { chart = root; }
      if (!groups.has(chart)) groups.set(chart, []);
      groups.get(chart).push({ bar, box });
    });

    for (const geoms of groups.values()) {
      let horizontal;
      if (bars === 'horizontal' || bars === 'vertical') {
        horizontal = bars === 'horizontal';
      } else {
        // Rounded to whole pixels: bars that genuinely share a width can
        // still differ by sub-pixel layout noise, which would otherwise make
        // every value distinct and defeat the comparison.
        const widths = new Set(geoms.map(g => Math.round(g.box.width)));
        const heights = new Set(geoms.map(g => Math.round(g.box.height)));
        // Ties (including a single bar, where both sets are size 1) fall to
        // vertical — the far more common chart shape, and the direction this
        // whole feature is specified in terms of.
        horizontal = heights.size < widths.size;
      }

      // Anchor edge. The default — and the ONLY behaviour for an ordinary
      // chart — is each bar's LOW edge: its bottom when vertical, its left
      // when horizontal. That is "rises from the baseline" for a plain
      // ranking and for every segment of a stack alike.
      //
      // `signed` opts into the diverging case (Unit P&L's net contribution),
      // where bars sit on BOTH sides of a zero line: a positive bar meets
      // the axis at its low edge and a negative one at its high edge, so a
      // blanket low-edge anchor grows losses AWAY from zero. There, the
      // pixel position recurring most across the set is the zero line, and
      // each bar is anchored at whichever of its own edges matches it.
      //
      // That modal-edge trick is deliberately NOT the default, because it is
      // wrong for stacked charts: a stack's segment junction is shared by
      // two segments and can out-count the real axis, which anchored small
      // stacked segments at their TOP and grew them downward. Verified
      // against real Recharts output in a browser — a stacked chart with a
      // lopsided series is exactly where it broke.
      let zeroEdge = null;
      if (signed) {
        const edgeCounts = new Map();
        const bump = (v) => edgeCounts.set(v, (edgeCounts.get(v) ?? 0) + 1);
        for (const { box } of geoms) {
          bump(Math.round(horizontal ? box.x : box.y + box.height));
          bump(Math.round(horizontal ? box.x + box.width : box.y));
        }
        let best = -1;
        for (const [edge, count] of edgeCounts) {
          if (count > best) { best = count; zeroEdge = edge; }
        }
        // A single shared edge is just "every bar starts here" — no
        // diverging axis to speak of, so fall back to the plain rule.
        if (best < 2) zeroEdge = null;
      }

      for (const { bar, box } of geoms) {
        const low = Math.round(horizontal ? box.x : box.y + box.height);
        const high = Math.round(horizontal ? box.x + box.width : box.y);
        // Only a bar that touches the zero line with its HIGH edge (and not
        // its low one) is on the negative side.
        const anchorHigh = zeroEdge !== null && high === zeroEdge && low !== zeroEdge;
        // fill-box makes the bar's own bounding box the transform reference,
        // so it grows out of the axis rather than the SVG origin.
        bar.style.transformBox = 'fill-box';
        bar.style.transformOrigin = horizontal
          ? (anchorHigh ? 'right center' : 'left center')
          : (anchorHigh ? 'center top' : 'center bottom');
        animate(bar, [
          { transform: horizontal ? 'scaleX(0)' : 'scaleY(0)' },
          { transform: 'none' },
        ]);
      }
    }
  } catch {
    /* never let a decorative animation break a render */
  }

  return () => {
    running.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
  };
}

// True once Recharts has actually PAINTED something animatable inside
// `root` — i.e. a stroked path with real length, or at least one bar.
function chartIsReady(root) {
  if (!root) return false;
  try {
    const paths = root.querySelectorAll('.recharts-line-curve, .recharts-area-curve');
    for (const p of paths) {
      try {
        if (typeof p.getTotalLength === 'function' && p.getTotalLength() > 0) return true;
      } catch { /* try the next one */ }
    }
    return root.querySelectorAll('.recharts-bar-rectangle').length > 0;
  } catch {
    return false;
  }
}

// Schedules `runChartDrawIn` for the moment Recharts has actually committed
// its SVG — POLLING per frame rather than assuming a fixed delay.
//
// This is load-bearing, and was the bug that made earlier attempts silently
// do nothing: `ResponsiveContainer` sizes itself from a ResizeObserver, so
// on first mount it renders an EMPTY chart and only fills it in once that
// observer fires. A fixed "wait two frames" therefore measured
// `getTotalLength()` on a path that did not exist yet, read 0, and skipped
// the animation entirely — no error, no animation, nothing to see.
//
// Waiting for readiness instead means the draw-on fires whenever the chart
// genuinely appears, however long layout took. The frame budget bounds it
// so a chart that never renders (empty series) cannot poll forever.
const READY_POLL_FRAMES = 90; // ~1.5s at 60fps

export function scheduleChartDrawIn(getRoot, opts) {
  let rafId = 0;
  let cancelRun = null;
  let cancelled = false;
  let frames = 0;

  const tick = () => {
    if (cancelled) return;
    const root = getRoot();
    if (chartIsReady(root)) {
      cancelRun = runChartDrawIn(root, opts);
      return;
    }
    if (frames++ >= READY_POLL_FRAMES) return; // nothing to animate — give up quietly
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
    if (cancelRun) cancelRun();
  };
}
