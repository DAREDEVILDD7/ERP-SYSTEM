import { useEffect, useState } from 'react';
import './ClaudeTypingLoader.css';

/* ─────────────────────────────────────────────────────────────────────────
 * ClaudeTypingLoader
 *
 * The Analytics module's own in-panel loading animation: the JTC-capped
 * Claude mascot working away while an insight is being generated. Always
 * rendered INSIDE an Analytics panel (position: absolute over that panel's
 * content area) — never a full-screen overlay, so the sidebar, top nav and
 * page header always stay visible and untouched.
 *
 * Two consumers, one component and one asset instance per consumer — the
 * animation, CSS, keyframes and timings below are shared verbatim, nothing
 * is duplicated or re-tuned per site:
 *   1. AnalyticsPage — on entering the workspace (sidebar → /analytics),
 *      over the chat-surface card.
 *   2. SectionCard   — on each submitted prompt, over that answer's card.
 * Both gate visibility with `useMinDurationGate` below, so the animation is
 * guaranteed a minimum on-screen time and simply runs longer when the work
 * outlasts it.
 *
 * Exclusive to Analytics. It shares nothing with the truck loading
 * animation / AppLoadingGate, and its CSS is `jtca-`-prefixed so it cannot
 * reach any other surface.
 *
 * ── The artwork: a 5-pose x 8-row typing sheet ─────────────────────────
 * `public/analytics/claude-jtc-typing.png` is the frame-sequence asset the
 * earlier single-pose bitmap was always missing: a 5-column x 8-row grid of
 * 289x153 cells, built from the five poses supplied on 2026-08-05.
 * Every pose contains the mascot, the JTC cap, both arms with hands ON a
 * laptop keyboard, and the laptop itself — so the typing, the cap bounce
 * and the head movement are all DRAWN rather than faked with transforms.
 *
 * The COLUMN is the pose. The ROW encodes two further axes that the source
 * art did not have, both synthesised by `scripts/build_claude_typing_sheet.py`
 * from each pose's own pixels — nothing is invented or hand-drawn:
 *   • hand lift (rows n+0..n+3 = hands at 0 / 7 / 13 / 20 sheet px above the
 *     keys). Each arm column's whole below-the-cut content slides up as one
 *     unit; the excised slice is invisible because the tentacle is a single
 *     flat colour, and whatever the hand vacates is filled from a laptop
 *     plate reconstructed from the union of all five poses (each occludes a
 *     different part of it). The build asserts every lifted cell differs
 *     from its rest cell ONLY left of the torso and above the ground line,
 *     so the body, cap, eyes and laptop are provably untouched.
 *   • blink (rows 0-3 eyes open, rows 4-7 the same four lifts with the eyes
 *     shut). The eye box is flood-filled with the surrounding face's modal
 *     tone and a 4px lid bar in the eye's own colour is drawn at 58% height.
 * Two stacked row layers therefore address `row = blink * 4 + lift`, which
 * is why the blink and the hand rhythm can run on completely independent
 * timers over ONE image.
 *
 * The sheet is generated from those five PNGs by a normalisation pass, and
 * that pass is why playback does not jitter:
 *   • the annotation badges on poses 1, 2 and 4 are stripped;
 *   • the poses were drawn independently and drift by a few px, so each is
 *     registered by integer translation onto two rigid world anchors — the
 *     laptop lid tip (x) and the ground line (y). Interocular distance
 *     varies by <=1.5%, so no rescale is applied and the pixel art stays
 *     crisp;
 *   • the ground line's thickness and end points differ per pose, which
 *     would shimmer, so one canonical band is laid behind every cell;
 *   • each cell carries a transparent gutter, so sub-pixel rounding at the
 *     window edge can only ever expose blank space, never a neighbour.
 * Registering on the WORLD (not on the mascot) is deliberate: it keeps each
 * pose's own hand-to-keyboard contact exactly as drawn. The mascot's
 * residual lean is then real body motion, and the frame ORDER in the CSS is
 * authored so that lean stays smooth — see the `jtca-frames` comment.
 *
 * What is still NOT drawn anywhere in this asset: separate fingers. The
 * hands are the tentacle tips, so per-finger articulation remains out of
 * reach and is deliberately not faked. The lift rows give the arms and
 * hands real vertical travel against a real keyboard; they do not give the
 * mascot fingers it was never drawn with.
 *
 * The superseded single-pose asset (`claude-jtc.svg`) is intentionally left
 * in place; nothing references it any more.
 *
 * ── Fade-out contract ─────────────────────────────────────────────────
 * `visible` going false does NOT unmount immediately: the container fades
 * over FADE_MS and only then unmounts. During that window the <img> is the
 * same element with only its ancestor's opacity changing, so the SVG is
 * never re-decoded or re-rendered. Being absolutely positioned, neither
 * its arrival nor its departure can shift the card's layout.
 * ───────────────────────────────────────────────────────────────────────── */

const FADE_MS = 260;
/* 5x8 typing sheet. One URL, so N mounted loaders share a single decode,
 * and the pose / lift / blink stepping never fetches or re-decodes. */
const ASSET = '/analytics/claude-jtc-typing.png';

/* Minimum time the loader stays up once shown, so a cached or instant
 * result cannot flash it for 80ms. Exported (rather than duplicated at each
 * call site) so the workspace-entry animation and the per-prompt animation
 * can never drift apart. */
export const ANALYTICS_LOADER_MIN_MS = 3000;

/**
 * True while still inside the minimum-display window measured from mount.
 *
 * Deliberately a floor, not a delay: callers OR this with their own pending
 * state (`gate || isLoading`), which gives "at least MIN_MS, and longer if
 * the work is still running" without ever postponing the work itself — the
 * query still fires on mount as it always did.
 *
 * One shot per mount, which is exactly right for both consumers: entering
 * the Analytics workspace mounts the page, and each submitted prompt mounts
 * a fresh SectionCard.
 */
export function useMinDurationGate(minMs = ANALYTICS_LOADER_MIN_MS) {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    // Guard against a non-finite/negative override disabling the gate.
    const ms = Number.isFinite(minMs) && minMs > 0 ? minMs : 0;
    if (ms === 0) {
      setElapsed(true);
      return undefined;
    }
    setElapsed(false);
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [minMs]);

  return !elapsed;
}

export default function ClaudeTypingLoader({
  visible = true,
  message = 'Analyzing your data',
  className = '',
}) {
  // Kept mounted for one fade after `visible` drops, then removed.
  const [rendered, setRendered] = useState(visible);
  // If the asset 404s or fails to decode, degrade to the message alone
  // rather than showing a broken-image glyph.
  const [assetFailed, setAssetFailed] = useState(false);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setRendered(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!rendered) return null;

  return (
    <div
      className={`jtca-root ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-out`,
        /* Only while exiting: a wash that masks the just-mounted results
           underneath, then fades away with the container — giving a clean
           cross-fade instead of the artwork and the charts briefly
           superimposing. Transparent while loading so the loader reads as
           part of the glass card. */
        backgroundColor: visible ? 'transparent' : 'rgba(255, 255, 255, 0.78)',
      }}
      role="status"
      aria-live="polite"
      aria-label={`${message}…`}
    >
      {!assetFailed && (
        /* figure = breathing, keys = keystroke dip + laptop shake, stage =
           the fixed one-cell window, lift = the hand-height row, blink = the
           eyes-open/shut row, sprite = the stepped sheet's pose column. Each
           layer owns exactly one transform so they compose instead of
           overwriting one another; lift nests inside blink's coordinate space
           so the two row offsets add (row = blink * 4 + lift), which is what
           lets the hands, the blink and the pose each run on their own timer
           rather than one welded cycle — see ClaudeTypingLoader.css. Still
           exactly one <img>: every wrapper is a plain div. */
        <div className="jtca-figure">
          <div className="jtca-keys">
            <div className="jtca-stage">
              <div className="jtca-lift">
                <div className="jtca-blink">
                  <img
                    src={ASSET}
                    alt=""
                    draggable={false}
                    className="jtca-sprite"
                    decoding="async"
                    onError={() => setAssetFailed(true)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* `.jtca-keycaps` (three small pulsing red squares beneath the
          mascot) was removed as an unintended small-click artifact per
          request. The impact marks on poses 2/4/5 remain the sole
          "click effect", drawn into the sprite itself so the mascot's
          typing rhythm still reads as strikes. The CSS rules are left
          in place unchanged so nothing else in the loader can regress
          from this edit; they are simply no longer referenced. */}
      <p className="jtca-message">
        {message}
        <span className="jtca-ellipsis" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
