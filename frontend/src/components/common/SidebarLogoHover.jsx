import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";

/* ---------------------------------------------------------------------------
 * Sidebar logo hover animation
 *
 * Renders the same 8-piece decomposition of jtc-full-logo.svg used by the
 * loading screen (`src/components/loading/JTCLogoAnimation.jsx`) inside the
 * sidebar header, so a scaled-down replay of the loading sequence can be
 * triggered on hover. Every constant below — canvas dims, piece coordinates,
 * SVG paths, group indices, timing constants (`SPEED`, `PLACE_DUR_S`,
 * `FLOURISH_DUR_S`), per-group release delays and every easing curve —
 * mirrors the loading component byte-for-byte. Nothing in the loading page
 * animation itself is touched by this file; the values are simply replayed
 * here at the sidebar-header scale.
 *
 * Hover timeline (the sidebar's answer to the loading page's truck delivery):
 *   idle              → assembled logo visible, waiting for hover
 *   wedge-sweep-left  → letters + dot instantly hidden inside the wedge; the
 *                        wedge smoothly translates from its logo position to
 *                        the exact centre of the header
 *   wedge-return      → wedge translates back to its rest slot; as it moves
 *                        rightward the three letter groups (J+dot, T, C)
 *                        emerge sequentially from wherever the wedge is at
 *                        each group's release moment — same PLACE_DUR_S
 *                        glide, same easing, same release delays as loading
 *   flourish          → dot arcs from beside-J onto its perch above the J,
 *                        identical projectile+bounce variant as loading
 *   idle              → assembled logo, identical to the starting frame
 * ------------------------------------------------------------------------- */

// Full logo canvas — viewBox of jtc-full-logo.svg
const LOGO_W = 427;
const LOGO_H = 138;

// Piece coordinates — canonical decomposition of jtc-full-logo.svg. Identical
// to PIECES in JTCLogoAnimation.jsx *except* the dot has been nudged 0.55
// canvas-units left (40.3008 → 39.75) so its centre sits directly above the
// J stem's centre — see the matching change in JTCLogoAnimation.jsx.
const PIECES = [
  { id: "dot",         src: "/logo/jtc-dot.svg",             x: 39.75,   y: 0,       w: 41, h: 41,  z: 1, group: 0 },
  { id: "j-body",      src: "/logo/jtc-letter-j-body.svg",   x: 0,       y: 55.7,    w: 78, h: 82,  z: 1, group: 0 },
  { id: "t-stem",      src: "/logo/jtc-letter-t-stem.svg",   x: 104,     y: 55.7,    w: 77, h: 82,  z: 1, group: 1 },
  { id: "t-bar",       src: "/logo/jtc-letter-t-bar.svg",    x: 97,      y: 3.7,     w: 87, h: 31,  z: 1, group: 1 },
  { id: "c",           src: "/logo/jtc-letter-c.svg",        x: 201,     y: 3.69775, w: 83, h: 134, z: 1, group: 2 },
  { id: "wedge",       src: "/logo/jtc-icon-wedge.svg",      x: 302,     y: 22.36,   w: 99, h: 97,  z: 1, group: 3 },
  { id: "flag-top",    src: "/logo/jtc-icon-flag-top.svg",   x: 336,     y: 3.7,     w: 91, h: 47,  z: 2, group: 3 },
  { id: "flag-bottom", src: "/logo/jtc-icon-flag-bottom.svg",x: 336,     y: 91.57,   w: 91, h: 47,  z: 2, group: 3 },
];

const LETTER_PIECES = PIECES.filter((p) => p.group < 3);
const WEDGE_PIECES  = PIECES.filter((p) => p.group === 3);
const DOT_PIECE     = PIECES.find((p) => p.id === "dot");

// Wedge (package) bounding box — same as JTCLogoAnimation.jsx
const PKG_X0 = 302;
const PKG_Y0 = 3.7;
const PKG_X1 = 427;
const PKG_Y1 = 138.57;
const PKG_W  = PKG_X1 - PKG_X0;    // 125
const PKG_H  = PKG_Y1 - PKG_Y0;    // 134.87
const PKG_CX = (PKG_X0 + PKG_X1) / 2;
const PKG_CY = (PKG_Y0 + PKG_Y1) / 2;

// Per-group centre in logo-canvas coordinates — every member of a group
// shares the exact same start delta, so grouped pieces move as one unit
// (same computation as JTCLogoAnimation.jsx).
const GROUP_CENTERS = Array.from({ length: 4 }, (_, g) => {
  const members = PIECES.filter((p) => p.group === g);
  const x0 = Math.min(...members.map((p) => p.x));
  const x1 = Math.max(...members.map((p) => p.x + p.w));
  const y0 = Math.min(...members.map((p) => p.y));
  const y1 = Math.max(...members.map((p) => p.y + p.h));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
});

// Loading-page timing constants — identical to JTCLogoAnimation.jsx.
const SPEED           = 3;
const PLACE_DUR_S     = 1.0 / SPEED;    // one group's pop-out → glide
const FLOURISH_DUR_S  = 0.9 / SPEED;    // dot arc + bounce
const T_APEX          = 1.0 / SPEED;
const T_TUMBLE1       = 1.52 / SPEED;
const T_TUMBLE2       = 1.8  / SPEED;
// Same relative spacing between the three letter groups as loading
// (T_APEX → 0, T_TUMBLE1 → group 1, T_TUMBLE2 → group 2).
const RELEASE_DELAY_S = [0, T_TUMBLE1 - T_APEX, T_TUMBLE2 - T_APEX];

// Wedge sweep — the sidebar's substitute for the loading page's truck. The
// wedge slides from its rest slot to the header centre, then continues
// rightward back to rest; the letters emerge during the return leg.
// LEFT sweep is easeInOut for a natural swing; RETURN is linear so the
// release-position calculation below tracks the wedge exactly.
const WEDGE_SWEEP_LEFT_MS = 260;
const WEDGE_RETURN_MS     = 700;
// Amount the wedge translates leftward, in canvas units. Puts the wedge's
// centre exactly on the logo canvas's horizontal centre (LOGO_W / 2 = 213.5).
const WEDGE_LEFT_OFFSET_CANVAS = (LOGO_W / 2) - PKG_CX;   // = -151

const FLOURISH_TOTAL_MS = Math.ceil(FLOURISH_DUR_S * 1000);

/* Dot's "beside the J on the baseline" resting offset — the delta from the
 * dot's native position to the "beside J" staging spot the loading page
 * derives from live geometry. Rewritten in canvas units so it holds under
 * any sidebar size without a measurement step. Formula matches the loading
 * page's rOx / rOy exactly:
 *   rOx = max(logo.left - fw*1.6, 2) - fx   →   -1.6·piece.w  -  piece.x
 *   rOy = logo.top + logo.height - fh - fy  →   LOGO_H - piece.h - piece.y
 */
const DOT_ASIDE_OX_CANVAS = -1.6 * DOT_PIECE.w - DOT_PIECE.x;   // ≈ -105.35
const DOT_ASIDE_OY_CANVAS = LOGO_H - DOT_PIECE.h - DOT_PIECE.y; // = 97

// Convert a delta in canvas units to a percentage of the piece's own box —
// framer-motion resolves `x: '10%'` relative to the animated element itself,
// so a per-piece denominator is required. Using percentages (rather than
// pixels) keeps the animation identical in the expanded and collapsed
// sidebar states without any measurement step or resize re-renders.
const dxPct = (piece, dxCanvas) => `${(dxCanvas / piece.w) * 100}%`;
const dyPct = (piece, dyCanvas) => `${(dyCanvas / piece.h) * 100}%`;

// Linear interpolation of the wedge's canvas offset from rest at each
// letter-group release moment. The wedge return uses `linear` easing, so
// this is exact — each letter genuinely emerges from where the wedge is
// at that instant, mirroring the loading page's release choreography.
function wedgeOffsetAtReleaseCanvas(group) {
  const tS = RELEASE_DELAY_S[group];
  const returnS = WEDGE_RETURN_MS / 1000;
  const fractionElapsed = Math.min(1, tS / returnS);
  return WEDGE_LEFT_OFFSET_CANVAS * (1 - fractionElapsed);
}

// Letter start position in canvas units, taking the moving wedge into
// account — same formula as JTCLogoAnimation.getLetterAnim's `sx, sy`:
//   sx = relX − group_cx + 0.1·pkg_w   where relX is the wedge's centre at release
//   sy = relY − group_cy               (the wedge doesn't move vertically here)
function letterStartCanvas(piece) {
  const gc = GROUP_CENTERS[piece.group];
  const wedgeOffset = wedgeOffsetAtReleaseCanvas(piece.group);
  return {
    sx: (PKG_CX + wedgeOffset) - gc.cx + 0.1 * PKG_W,
    sy: (PKG_CY - gc.cy),
  };
}

// Build the framer-motion `animate` + `transition` pair for a single letter
// piece at a given phase. Purely a function of `phase` and the (constant)
// piece geometry.
function buildLetterAnim(piece, phase) {
  const isDot = piece.id === "dot";
  const { sx, sy } = letterStartCanvas(piece);
  const rOx = isDot ? DOT_ASIDE_OX_CANVAS : 0;
  const rOy = isDot ? DOT_ASIDE_OY_CANVAS : 0;

  if (phase === "idle") {
    // Assembled logo — every piece sits at its native SVG position (0,0).
    return {
      animate: { x: "0%", y: "0%", opacity: 1 },
      transition: { duration: 0 },
    };
  }

  if (phase === "wedgeLeft") {
    // Instantly hide letters and plant them inside the (still-moving) wedge.
    // Duration 0 so the visible transition from "assembled logo" to
    // "wedge only" is a snap-cut — the assembled logo disappears the moment
    // the wedge takes over, as required.
    return {
      animate: {
        x: dxPct(piece, sx + rOx),
        y: dyPct(piece, sy + rOy),
        opacity: 0,
      },
      transition: { duration: 0 },
    };
  }

  if (phase === "letters") {
    // Same emerge variant as JTCLogoAnimation.getLetterAnim("run"): small
    // lift out of the wedge, decelerating glide to the final slot, opacity
    // fades in during the first 22% of the interval. Each group's `sx`
    // reflects the wedge's actual position at its release moment (via
    // `wedgeOffsetAtReleaseCanvas`) so pieces visibly emerge from the
    // wedge as it sweeps rightward.
    const lift = 0.06 * PKG_H;
    const delay = RELEASE_DELAY_S[piece.group];
    return {
      animate: {
        x: [dxPct(piece, sx + rOx), dxPct(piece, rOx)],
        y: [
          dyPct(piece, sy + rOy),
          dyPct(piece, sy + rOy - lift),
          dyPct(piece, rOy),
        ],
        opacity: [0, 1, 1],
      },
      transition: {
        x: {
          duration: PLACE_DUR_S,
          delay,
          ease: [0.16, 0.68, 0.3, 1],
        },
        y: {
          duration: PLACE_DUR_S,
          delay,
          times: [0, 0.4, 1],
          ease: [
            [0.3, 0.6, 0.4, 1],
            [0.4, 0, 0.3, 1],
          ],
        },
        opacity: {
          duration: PLACE_DUR_S,
          delay,
          times: [0, 0.22, 1],
          ease: "linear",
        },
      },
    };
  }

  if (phase === "flourish") {
    if (!isDot) {
      // All letters are already seated — hold them in place.
      return {
        animate: { x: "0%", y: "0%", opacity: 1 },
        transition: { duration: 0 },
      };
    }
    // Same projectile toss as JTCLogoAnimation.getLetterAnim("flourish"):
    // constant horizontal velocity, gravity parabola on y, then a small
    // bounce settle onto the perch (dot's native position).
    const apex   = DOT_PIECE.h * 0.7;
    const bounce = DOT_PIECE.h * 0.28;
    const times  = [0, 0.42, 0.62, 0.82, 1];
    return {
      animate: {
        x: [
          dxPct(DOT_PIECE, rOx),
          dxPct(DOT_PIECE, 0.32 * rOx),
          "0%",
          "0%",
          "0%",
        ],
        y: [
          dyPct(DOT_PIECE, rOy),
          dyPct(DOT_PIECE, -apex),
          "0%",
          dyPct(DOT_PIECE, -bounce),
          "0%",
        ],
        opacity: 1,
      },
      transition: {
        x: {
          duration: FLOURISH_DUR_S,
          times,
          ease: ["linear", "linear", "linear", "linear"],
        },
        y: {
          duration: FLOURISH_DUR_S,
          times,
          ease: [
            [0.5, 1, 0.89, 1],
            [0.11, 0, 0.5, 0],
            [0.3, 0.6, 0.4, 1],
            [0.5, 0, 0.65, 0.6],
          ],
        },
      },
    };
  }

  return { animate: { x: "0%", y: "0%", opacity: 1 }, transition: { duration: 0 } };
}

// Build the framer-motion `animate` + `transition` pair for the wedge
// package (rigid body, one transform). The wedge is at rest for every
// phase except the two sweep phases.
function buildWedgeAnim(phase) {
  const leftOffsetPct = dxPct({ w: PKG_W }, WEDGE_LEFT_OFFSET_CANVAS);

  if (phase === "wedgeLeft") {
    return {
      animate: { x: leftOffsetPct },
      transition: { duration: WEDGE_SWEEP_LEFT_MS / 1000, ease: [0.4, 0, 0.2, 1] },
    };
  }
  if (phase === "letters") {
    // Straight-line return — linear so `wedgeOffsetAtReleaseCanvas` above
    // gives the wedge's actual position at each letter-release moment.
    return {
      animate: { x: "0%" },
      transition: { duration: WEDGE_RETURN_MS / 1000, ease: "linear" },
    };
  }
  // idle / flourish / any other resting state
  return {
    animate: { x: "0%" },
    transition: { duration: 0 },
  };
}

export default function SidebarLogoHover({ collapsed }) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState("idle");
  // A single timer handle so a component-unmount mid-flight cancels the
  // scheduler cleanly — no orphan setState calls, no interleaved phases.
  const timerRef = useRef(null);

  const startAnimation = useCallback(() => {
    // Debounce: ignore hover while a run is in flight. Only transitions
    // out of `idle` are ever kicked off here.
    if (phase !== "idle" || reducedMotion) return;
    setPhase("wedgeLeft");
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (phase === "wedgeLeft") {
      timerRef.current = setTimeout(() => setPhase("letters"), WEDGE_SWEEP_LEFT_MS);
    } else if (phase === "letters") {
      // + tiny guard so the last-group PLACE animation can settle before
      // the flourish phase overwrites its animate target.
      timerRef.current = setTimeout(() => setPhase("flourish"), WEDGE_RETURN_MS + 20);
    } else if (phase === "flourish") {
      timerRef.current = setTimeout(() => setPhase("idle"), FLOURISH_TOTAL_MS + 20);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  // Reduced-motion users: never animate; render the flat SVG exactly as
  // the sidebar's previous <img> would have.
  if (reducedMotion) {
    return (
      <img
        src="/logo/jtc-full-logo.svg"
        alt="JTC"
        draggable={false}
        className={clsx(
          "block select-none shrink-0",
          collapsed ? "w-full h-auto max-h-6" : "w-24 h-auto"
        )}
        style={{ aspectRatio: "427 / 138" }}
      />
    );
  }

  const wedge = buildWedgeAnim(phase);

  return (
    <div
      role="img"
      aria-label="JTC"
      onMouseEnter={startAnimation}
      className={clsx(
        "block select-none shrink-0 relative",
        collapsed ? "w-full max-h-6" : "w-24"
      )}
      style={{
        aspectRatio: "427 / 138",
        // The dot swings to the left of the logo box during its beside-J
        // staging — allow it to draw outside the container so it never
        // gets clipped in the compact header.
        overflow: "visible",
        cursor: phase === "idle" ? "pointer" : "default",
      }}
    >
      {LETTER_PIECES.map((piece) => {
        const { animate, transition } = buildLetterAnim(piece, phase);
        return (
          <motion.img
            key={piece.id}
            src={piece.src}
            alt=""
            draggable={false}
            initial={false}
            animate={animate}
            transition={transition}
            aria-hidden
            style={{
              position: "absolute",
              left:   `${(piece.x / LOGO_W) * 100}%`,
              top:    `${(piece.y / LOGO_H) * 100}%`,
              width:  `${(piece.w / LOGO_W) * 100}%`,
              height: `${(piece.h / LOGO_H) * 100}%`,
              zIndex: 20 + piece.z,
              // pieces never intercept the pointer — the wrapper alone
              // owns the hover surface, so moving between pieces cannot
              // fire spurious mouseenter/mouseleave events
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* Wedge assembly — three static SVGs in one rigid container that is
          animated as a single body. Sits above the letter pieces (z=23 vs
          21) so they visibly emerge from behind it. */}
      <motion.div
        initial={false}
        animate={wedge.animate}
        transition={wedge.transition}
        aria-hidden
        style={{
          position: "absolute",
          left:   `${(PKG_X0 / LOGO_W) * 100}%`,
          top:    `${(PKG_Y0 / LOGO_H) * 100}%`,
          width:  `${(PKG_W  / LOGO_W) * 100}%`,
          height: `${(PKG_H  / LOGO_H) * 100}%`,
          zIndex: 23,
          pointerEvents: "none",
          transformOrigin: "50% 50%",
        }}
      >
        {WEDGE_PIECES.map((piece) => (
          <img
            key={piece.id}
            src={piece.src}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left:   `${((piece.x - PKG_X0) / PKG_W) * 100}%`,
              top:    `${((piece.y - PKG_Y0) / PKG_H) * 100}%`,
              width:  `${(piece.w / PKG_W) * 100}%`,
              height: `${(piece.h / PKG_H) * 100}%`,
              zIndex: piece.z,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
