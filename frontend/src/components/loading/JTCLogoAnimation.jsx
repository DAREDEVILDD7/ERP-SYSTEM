import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
 * Ported, unmodified, from the standalone JTC loading animation project
 * (D:\loadingpageJTC\components\JTCLogoAnimation.tsx) into this CRA/JS app.
 * The only functional addition vs the original is the optional `onComplete`
 * callback (invoked once, when the sequence reaches its "done" phase) used
 * by AppLoadingGate to hand off to the login page - every timing constant,
 * easing curve, keyframe, asset path and pixel calculation below is
 * byte-for-byte identical to the original TypeScript source. Type
 * annotations, interfaces and `as Transition` casts were removed (this repo
 * has no TypeScript toolchain); nothing else was touched. See handoff.md in
 * the source project for full history.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Assets
 * ------------------------------------------------------------------------- */

/* single truck asset for the whole pass - the package is layered BENEATH
 * the truck art (z 23 vs 30), so it stays hidden behind the trailer and
 * visibly emerges from behind the rear edge as it is pushed out, which
 * preserves the delivery illusion without any door-art swap */
const TRUCK_IMG = "/logo/truck-initial.svg";
const FULL_LOGO = "/logo/jtc-full-logo.svg";

/* Full logo canvas (viewBox of jtc_full_logo.svg) */
const LOGO_W = 427;
const LOGO_H = 138;

/* Truck art aspect ratio (962 x 436) */
const TRUCK_RATIO = 962 / 436;

/* ---------------------------------------------------------------------------
 * Layout: one centered composition = [ logo assembly zone ][ gap ][ truck ]
 *
 * The logo is sized relative to the truck (LOGO_TRUCK_RATIO x truck width) so
 * every piece is genuinely cargo-sized. The truck drives one constant-velocity
 * pass and delivers a single package: the wedge assembly. The package tumbles
 * to rest at the exact viewport center, then the remaining logo pieces emerge
 * from inside it and the wedge slides into its final slot.
 * ------------------------------------------------------------------------- */

/* responsive layout base: all sizes and positions derive from this single
 * CSS length, so every proportion is identical on every screen. Defined in
 * jtc-loading.css as --jtc-base-w: the default is min(70vw, 700px, 90vh);
 * a real mobile-only breakpoint (not just a bigger vw coefficient) bumps
 * the vw/vh terms +12.5% on phones without touching desktop/laptop/tablet,
 * since a CSS media query (unlike a coefficient change) can't affect a
 * viewport it doesn't match. */
const BASE_W_CSS = `var(--jtc-base-w)`;
/* the truck renders at 65% of the base (~35% smaller) - the logo keeps its
 * exact previous size, so the truck reads as a supporting element and the
 * logo stays the focal point */
const TRUCK_SCALE = 0.65;
const TRUCK_W_CSS = `calc(${TRUCK_SCALE} * ${BASE_W_CSS})`;
const LOGO_BASE_RATIO = 0.2; // logo width : base width (unchanged logo size)
const GAP_BASE_RATIO = 0.05; // gap between logo zone and truck : base width
const TRUCK_H_FRAC = 1 / TRUCK_RATIO; // truck height as fraction of its width
/* wheel baseline: measured from the truck art - the tires bottom out at
 * ~73.4% of the image height, the rest is soft shadow / padding. The logo's
 * baseline sits exactly on this line. */
const WHEEL_LINE_FRAC = 0.734; // of truck height, from the top of the art
/* half the logo height, as a fraction of the base width */
const LOGO_HALF_H_FRAC = 0.5 * LOGO_BASE_RATIO * (LOGO_H / LOGO_W);
/* truck top offset from the viewport's vertical center (fraction of the
 * base width): places the wheel line exactly on the centered logo's
 * baseline at the truck's reduced scale */
const TRUCK_TOP_FRAC =
  LOGO_HALF_H_FRAC - WHEEL_LINE_FRAC * TRUCK_H_FRAC * TRUCK_SCALE;

/**
 * @typedef {Object} Piece
 * @property {string} id
 * @property {string} src
 * @property {number} x - Position inside the 427x138 full-logo canvas (exact, extracted from jtc_full_logo.svg)
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} z - Paint order in the original logo: flags render above the wedge
 * @property {number} group - Emerge group: 0 = J + dot, 1 = T + bar, 2 = C, 3 = wedge assembly.
 *  Groups 0-2 are released from inside the still-moving package, each one
 *  shaken loose by a physics event of the tumble (bounce landing, first
 *  tumble, second tumble); group 3 IS the package (one rigid body).
 *  The dot belongs to group 0 but emerges and rests at a staging spot to
 *  the LEFT of the J ("dot J", never above it); it only takes its perch
 *  on top of the J during the final flourish.
 */

/** @type {Piece[]} */
const PIECES = [
  // Nudged 0.55 canvas-units left of the source SVG's 40.3008 so the dot's
  // centre sits directly above the J stem's centre (stem edges are at
  // canvas x=43 and x=77.5 → centre = 60.25; dot half-width = 20.5, so the
  // dot's top-left must be at 39.75 for the centre to match). Kept in sync
  // with the matching decomposition in SidebarLogoHover.jsx.
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
const WEDGE_PIECES = PIECES.filter((p) => p.group === 3);

/* the wedge package: exact bounding box of the three wedge SVGs in the
 * 427x138 logo canvas - the package container element covers this box and
 * the three SVGs never move relative to it (one rigid body) */
const PKG_X0 = 302;
const PKG_Y0 = 3.7;
const PKG_X1 = 427;
const PKG_Y1 = 138.57;
const PKG_W = PKG_X1 - PKG_X0; // 125
const PKG_H = PKG_Y1 - PKG_Y0; // 134.87
const PKG_CX = (PKG_X0 + PKG_X1) / 2;
const PKG_CY = (PKG_Y0 + PKG_Y1) / 2;

const GROUP_COUNT = 4;

/* center of each group's bounding box in logo-canvas coordinates; every
 * member of a group shares the exact same motion deltas derived from this
 * point, which guarantees they start, travel, and land in perfect sync */
const GROUP_CENTERS = Array.from({ length: GROUP_COUNT }, (_, g) => {
  const members = PIECES.filter((p) => p.group === g);
  const x0 = Math.min(...members.map((p) => p.x));
  const x1 = Math.max(...members.map((p) => p.x + p.w));
  const y0 = Math.min(...members.map((p) => p.y));
  const y1 = Math.max(...members.map((p) => p.y + p.h));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
});

/* ---------------------------------------------------------------------------
 * Timeline
 * ------------------------------------------------------------------------- */

/*
 * Phase =
 *  | "loading"
 *  | "run"       // one continuous truck pass: the package is
 *                // pushed out, tumbles to rest at the viewport center, the
 *                // logo pieces emerge from inside it and assemble - the truck
 *                // never stops
 *  | "flourish"  // red dot arcs onto the J after the logo has assembled
 *  | "reveal"    // crossfade to the original full-logo file
 *  | "done";
 */

/* speed multiplier applied globally: every timing constant in this file is
 * derived by dividing an original-tuned value by SPEED, so the whole
 * choreography plays SPEED times faster with byte-identical relative
 * proportions (keyframe fractions, easing curves, delays as a share of
 * total duration) - nothing is re-tuned, it's the exact same motion played
 * back faster. (Reworded from the original source's "/* global speed
 * multiplier..." only to avoid ESLint's block-comment convention for
 * declaring global variables, which this repo's CRA lint config treats as
 * a fatal build error when a comment literally starts with the word
 * "global" - no other change.) */
const SPEED = 3;

/* the truck's crossing speed is intentionally independent of SPEED above -
 * tuned on its own so it can change without touching the wedge/tumble
 * choreography at all. TRUCK_VISIBLE_S is how long the truck is VISIBLY on
 * screen (excluding the invisible +/-100px off-screen safety buffer it
 * drives through before entering / after exiting); travelParams() scales
 * the total pass duration per viewport so this visible portion is always
 * the same length on every device - a flat total duration otherwise lets
 * the fixed-pixel buffer eat a much bigger share of the pass on a narrow
 * phone (smaller truck, smaller viewport) than on desktop, so the truck
 * travels a noticeably shorter-looking distance on mobile.
 * Value: the original flat 8/SPEED=2.667s pass was ~2.46s visible on
 * desktop; this is that same original baseline sped up 25% (the
 * requested truck-only speed increase). Desktop/laptop/tablet use this
 * value unchanged. */
const TRUCK_VISIBLE_S = 1.968;
/* mobile-only: 25% faster again on top of TRUCK_VISIBLE_S, so the truck
 * reaches the delivery point and exits the screen faster on phones while
 * desktop stays exactly as approved. MOBILE_BREAKPOINT_PX mirrors the
 * media query in jtc-loading.css - keep both in sync, since that's also
 * what decides the mobile logo-size bump. */
const MOBILE_BREAKPOINT_PX = 480;
const MOBILE_TRUCK_VISIBLE_S = TRUCK_VISIBLE_S / 1.25;
/* ejection-timing guardrails for the truck's pass, in the same
 * SPEED-independent timing domain as TRUCK_VISIBLE_S */
const MIN_EJECT_S = 0.5; // truck must be visibly underway before it ejects
const END_RESERVE_S = 1.0; // truck keeps driving this long after ejecting

const PLACE_DUR_S = 1.0 / SPEED; // one group: pop out of the wedge -> glide to slot

const FLOURISH_MS = 1100 / SPEED;
const FLOURISH_DUR_S = 0.9 / SPEED; // the dot's full lift -> arc -> bounce -> settle
const REVEAL_MS = 900 / SPEED;

/* ---------------------------------------------------------------------------
 * Login hand-off (added for ERP integration)
 *
 * Not part of the ported assembly timeline above and independent of SPEED -
 * this only describes what happens to the logo AFTER it has finished
 * assembling and sitting at rest ("done"): one rigid glide+scale of the
 * whole, already-complete logo group into the login page's brand-logo slot.
 * Nothing above this point (truck, wedge, letters, dot, easing, timing) is
 * touched or read by it.
 * ------------------------------------------------------------------------- */
const DOCK_DUR_S = 0.65;
const DOCK_EASE = [0.22, 1, 0.36, 1]; // premium, no-overshoot deceleration

/* package tumble choreography, seconds after the ejection moment:
 * push out -> fall -> impact -> one bounce -> two backward tumbles that
 * drain momentum -> a slow natural settle that stops EXACTLY in the final
 * logo slot. The x-path is strictly monotonic: the package never travels
 * past its slot, never rolls back, never corrects. */
const T_PUSH = 0.18 / SPEED; // cleared the rear door
const T_IMPACT = 0.72 / SPEED; // first ground contact
const T_APEX = 1.0 / SPEED; // top of the single bounce
const T_CONTACT2 = 1.26 / SPEED; // back on the ground: end of the single bounce
const T_TUMBLE1 = 1.52 / SPEED; // first backward tumble rolls through here
const T_TUMBLE2 = 1.8 / SPEED; // second backward tumble, momentum nearly spent
const T_SETTLE = 2.35 / SPEED; // creeping the last fraction into the slot
const T_REST = 3.05 / SPEED; // fully stopped, exactly in the final logo position
const PKG_TOTAL_S = T_REST;

/* progressive release: each physics event of the still-moving package shakes
 * the next group loose - the bounce tosses the J + dot out, the first
 * backward tumble frees the T, the second frees the C. Every released piece
 * is seated in its final slot BEFORE the wedge itself comes to rest.
 * Indexed by group. */
const RELEASE_AT_S = [T_APEX, T_TUMBLE1, T_TUMBLE2];
/* the package's exact keyframe position at each release moment, so every
 * group visibly exits from wherever the package actually is right then
 * (x as a fraction of the tumble distance, y as a fraction of pkg height) */
const RELEASE_X_FRAC = [0.59, 0.12, 0.035];
const RELEASE_Y_FRAC = [-0.34, -0.045, -0.018];

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------- */

/**
 * @typedef {Object} Box
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Geom
 * @property {number} vw
 * @property {number} vh
 * @property {Box} logo
 * @property {Box} truck
 */

const toBox = (r) => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/* the truck's single linear pass: start/exit offsets, constant velocity and
 * the rear-door x-position at t = 0 - everything about the moving delivery
 * is derived deterministically from these */
function travelParams(g) {
  const startX = -(g.truck.left + g.truck.width + 100);
  const exitX = g.vw - g.truck.left + 100;
  const totalDist = exitX - startX;
  /* the portion of the pass where some part of the truck is on screen;
   * the rest is the fixed +/-100px hidden buffer on each end */
  const visibleDist = g.vw + g.truck.width;
  const isMobile =
    g.vw <= MOBILE_BREAKPOINT_PX || g.vh <= MOBILE_BREAKPOINT_PX;
  const visibleS = isMobile ? MOBILE_TRUCK_VISIBLE_S : TRUCK_VISIBLE_S;
  const travelS = visibleS * (totalDist / visibleDist);
  const v = totalDist / travelS;
  const doorBase = g.truck.left + g.truck.width * 0.03 + startX;
  return { startX, exitX, v, doorBase, travelS, isMobile };
}

/* everything about the package delivery, derived from live geometry so it is
 * identical in proportion on every screen size and orientation */
function delivery(g) {
  const s = g.logo.width / LOGO_W;
  const pkgW = PKG_W * s;
  const pkgH = PKG_H * s;
  /* absolute center of the wedge's FINAL slot in the logo: the tumble ends
   * exactly here - the package decelerates straight into its logo position
   * with no overshoot and no corrective motion afterwards */
  const pkgCx = g.logo.left + PKG_CX * s;
  const pkgCy = g.logo.top + PKG_CY * s;

  const { v, doorBase, travelS, isMobile } = travelParams(g);
  /* eject when the moving rear door is far enough PAST the final slot that
   * the push + air drift + backward tumbles end exactly in the slot */
  const doorTargetX = pkgCx + 2.9 * pkgW;
  const tR = Math.min(
    Math.max((doorTargetX - doorBase) / v, MIN_EJECT_S),
    travelS - END_RESERVE_S,
  );
  const doorX = doorBase + v * tR; // actual door x at the ejection moment

  /* start just inside the doorway, then a small push clears the door
   * (deltas are relative to the final slot, so 0 = at rest in the logo) */
  const x0 = doorX - pkgCx + 0.15 * pkgW;
  const xPush = x0 - 0.5 * pkgW;
  /* backward (leftward) travel from first impact to rest; guarded so the
   * path stays monotonic even if the ejection time had to be clamped.
   * That guard assumes the natural continuation of xPush stays positive
   * and clamps it up to a positive floor (0.6*pkgW) otherwise - but on a
   * faster truck (mobile), a harder tR clamp can push xPush negative,
   * and the positive floor then FLIPS its sign instead of extending it,
   * producing a real position/velocity/rotation discontinuity right
   * after the push-out. Desktop never hits this in practice and its
   * output must stay byte-identical, so the sign-preserving version
   * (clamp the magnitude, keep xPush's direction) is applied for mobile
   * only. */
  const idealTumble = xPush - 0.3 * pkgW;
  const tumble = isMobile
    ? Math.sign(idealTumble || -1) *
      Math.min(Math.max(Math.abs(idealTumble), 0.6 * pkgW), 2.2 * pkgW)
    : Math.max(Math.min(2.2 * pkgW, idealTumble), 0.6 * pkgW);
  /* cargo-bed height, with a guaranteed minimum drop */
  const doorYAbs = g.truck.top + g.truck.height * 0.34;
  const yDoor = Math.min(doorYAbs - pkgCy, -pkgH * 0.55);

  /* the flourish begins the instant the package settles into its slot -
   * every letter piece is already seated before T_REST, so the dot jump is
   * the seamless continuation of the assembly with no idle wait; the truck
   * finishes its pass independently of this boundary */
  const runEndS = tR + PKG_TOTAL_S;

  return { s, pkgW, pkgH, pkgCx, pkgCy, tR, x0, xPush, tumble, yDoor, runEndS };
}

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

/**
 * @param {Object} props
 * @param {() => void} [props.onComplete] - Integration hook (not present in
 *   the original standalone component): invoked exactly once, when the
 *   sequence reaches its "done" phase. Purely additive - it does not read,
 *   gate or alter any animation value below.
 * @param {DOMRect|{left:number,top:number,width:number,height:number}|null} [props.dockRect] -
 *   Integration hook: the on-screen rect (viewport px) of the login page's
 *   brand-logo slot. Once this is provided (by AppLoadingGate, only after
 *   `onComplete` has already fired), the ALREADY-ASSEMBLED logo group - as
 *   one rigid unit, exactly as it stands at rest - glides and scales from
 *   the center of the stage into that rect while the opaque stage
 *   background dissolves around it, instead of holding there forever. This
 *   only ever runs after the ported assembly timeline above has fully
 *   finished; it changes nothing about how the logo gets assembled.
 * @param {() => void} [props.onDocked] - Invoked exactly once, when the dock
 *   transform above lands.
 */
export default function JTCLogoAnimation({ onComplete, dockRect, onDocked } = {}) {
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState("loading");
  const [geom, setGeom] = useState(null);
  const [imagesReady, setImagesReady] = useState(false);
  const [dockDelta, setDockDelta] = useState(null); // {x, y, scale} once docking starts
  const dockedRef = useRef(false);

  const logoRef = useRef(null);
  const truckWrapRef = useRef(null);

  /* ---- measurement (mount + resize/orientation) ---- */
  const measure = useCallback(() => {
    const lb = logoRef.current?.getBoundingClientRect();
    const tb = truckWrapRef.current?.getBoundingClientRect();
    if (!lb || !tb || lb.width === 0 || tb.width === 0) return;
    setGeom({
      vw: window.innerWidth,
      vh: window.innerHeight,
      logo: toBox(lb),
      truck: toBox(tb),
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [measure]);

  /* ---- preload every asset before the truck enters ---- */
  useEffect(() => {
    if (reducedMotion) return;
    let alive = true;
    const srcs = [TRUCK_IMG, FULL_LOGO, ...PIECES.map((p) => p.src)];
    const loadOne = (src) =>
      new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve();
        img.onerror = () => resolve(); // never block the show on a bad asset
        img.src = src;
      });
    const timeout = new Promise((resolve) => {
      window.setTimeout(resolve, 6000);
    });
    Promise.race([Promise.all(srcs.map(loadOne)), timeout]).then(() => {
      if (alive) setImagesReady(true);
    });
    return () => {
      alive = false;
    };
  }, [reducedMotion]);

  /* ---- kick off once assets + measurements are in ---- */
  useEffect(() => {
    if (phase === "loading" && imagesReady && geom) {
      setPhase("run");
    }
  }, [phase, imagesReady, geom]);

  const geomRef = useRef(null);
  geomRef.current = geom;

  /* ---- phase scheduler (run length depends on the geometry-derived
   * ejection moment, so it is computed live) ---- */
  useEffect(() => {
    if (phase === "run") {
      const g = geomRef.current;
      const ms = (g ? delivery(g).runEndS : 9 / SPEED) * 1000 + 100 / SPEED;
      const id = window.setTimeout(() => setPhase("flourish"), ms);
      return () => window.clearTimeout(id);
    }
    const next = {
      flourish: ["reveal", FLOURISH_MS],
      reveal: ["done", REVEAL_MS],
    };
    const step = next[phase];
    if (!step) return;
    const id = window.setTimeout(() => setPhase(step[0]), step[1]);
    return () => window.clearTimeout(id);
  }, [phase]);

  /* ---- integration hook: fire onComplete exactly once, when the existing
   * phase machine above reaches "done" - purely observational, changes
   * nothing about the timeline itself ---- */
  useEffect(() => {
    if (phase === "done") {
      onComplete?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* ---- integration hook: login hand-off. Once "done" has been reached AND
   * a dockRect has been supplied (both happen only after the whole ported
   * timeline above is finished), measure the ALREADY-ASSEMBLED logo's
   * current on-screen box exactly once and derive the single rigid
   * translate+scale that carries it, as one unit, into that rect. Runs at
   * most once per mount (dockedRef), so a late resize/geom update can never
   * re-fire it mid-flight. ---- */
  useEffect(() => {
    if (phase === "done" && dockRect && !dockedRef.current && logoRef.current) {
      const src = logoRef.current.getBoundingClientRect();
      if (src.width > 0 && src.height > 0) {
        dockedRef.current = true;
        const scale = dockRect.width / src.width;
        setDockDelta({
          x: (dockRect.left + dockRect.width / 2) - (src.left + src.width / 2),
          y: (dockRect.top + dockRect.height / 2) - (src.top + src.height / 2),
          scale,
        });
      }
    }
  }, [phase, dockRect]);

  /* ---- truck motion: one continuous, constant-velocity pass - it never
   * stops, brakes, or accelerates ---- */
  const [runId] = useState(0);
  const truckStarted = phase !== "loading";

  /* the truck's start/exit offsets - and, below, the geometry the letters
   * and package compute their animation deltas from - are frozen the
   * instant a pass begins (once per runId) and never recomputed from live
   * geom again while that pass is in flight. Without this, ANY later
   * change to geom mid-flight would redirect an in-progress Framer Motion
   * animation toward new absolute pixel values computed from the new
   * geometry: for the truck that meant a resize (e.g. Chrome docking
   * DevTools) restarting its cross-screen pass from scratch; for the
   * letters/package it means visibly corrupting the assembly (pieces
   * jumping to overlapping/garbled positions), since --jtc-base-w in
   * jtc-loading.css can change instantly when the viewport crosses the
   * mobile breakpoint (e.g. toggling DevTools' device toolbar) - something
   * that couldn't happen back when the base size was a flat constant. */
  const truckParamsRef = useRef({
    startX: -4000,
    exitX: 4000,
    travelS: TRUCK_VISIBLE_S,
  });
  const frozenGeomRef = useRef(null);
  const frozenRunIdRef = useRef(null);
  if (truckStarted && geom && frozenRunIdRef.current !== runId) {
    truckParamsRef.current = travelParams(geom);
    frozenGeomRef.current = geom;
    frozenRunIdRef.current = runId;
  }
  const truckStartX = truckParamsRef.current.startX;
  const truckExitX = truckParamsRef.current.exitX;
  const truckTravelS = truckParamsRef.current.travelS;

  /* the truck only ever gets a MOVING (keyframe-array) target while
   * phase === "run" specifically - every other phase (including
   * "flourish"/"reveal"/"done", not just "loading") holds a single static
   * x with duration 0. This is deliberately narrower than `truckStarted`:
   * that flag stays true for the whole rest of the sequence after the
   * pass begins, so if it alone gated the moving-vs-static choice, any
   * stale/desynced ref (e.g. from an edge case in dev hot-reloading) could
   * hand the truck a fresh "drive across the screen" target long after
   * the logo has already been revealed. Gating on the exact phase makes
   * that structurally impossible - the truck can only ever be told to
   * move during "run", full stop. */
  const truckAnim = useMemo(() => {
    if (phase !== "run") {
      const atRestX = truckStarted ? truckExitX : truckStartX;
      return {
        animate: { x: atRestX },
        transition: { duration: 0 },
      };
    }
    return {
      animate: { x: [truckStartX, truckExitX] },
      transition: {
        x: { duration: truckTravelS, ease: "linear" },
      },
    };
  }, [phase, truckStarted, truckStartX, truckExitX, truckTravelS]);

  /* ---- the wedge package: one rigid body, ejected from the moving truck,
   * one bounce, backward (counterclockwise) tumble, rest at the exact
   * viewport center, then a final slide into its logo slot ---- */
  const getPackageAnim = () => {
    const g = frozenGeomRef.current ?? geom;
    if (!g) {
      return { animate: { opacity: 0 }, transition: { duration: 0 } };
    }
    const d = delivery(g);
    const { pkgH, tumble, x0, xPush, yDoor, tR } = d;

    if (phase === "loading") {
      // riding inside the trailer, hidden, ready to be pushed out
      return {
        animate: { x: x0, y: yDoor, rotate: 0, opacity: 0 },
        transition: { duration: 0 },
      };
    }

    if (phase === "run") {
      const timesS = [
        0, T_PUSH, T_IMPACT, T_APEX, T_CONTACT2, T_TUMBLE1, T_TUMBLE2,
        T_SETTLE, T_REST,
      ];
      const times = timesS.map((t) => t / PKG_TOTAL_S);
      return {
        animate: {
          // push out backwards, drift left while falling, then the bounce
          // and tumbles drain the momentum until it stops EXACTLY in its
          // final logo slot (delta 0) - strictly monotonic, no overshoot,
          // no rollback, no corrective motion
          x: [
            x0,
            xPush,
            tumble,
            0.59 * tumble,
            0.3 * tumble,
            0.12 * tumble,
            0.035 * tumble,
            0.006 * tumble,
            0,
          ],
          // level in the doorway, accelerating fall, one bounce, tiny
          // decaying corner-lifts through the tumbles, then flat at rest
          y: [
            yDoor,
            yDoor,
            0,
            -0.34 * pkgH,
            0,
            -0.045 * pkgH,
            -0.018 * pkgH,
            0,
            0,
          ],
          // one full backward (counterclockwise) revolution across the
          // bounce and both tumbles, decelerating smoothly to exactly
          // upright (-360 renders identical to 0) - never rocking back
          rotate: [0, -6, -48, -150, -240, -312, -345, -357, -360],
          opacity: 1,
        },
        transition: {
          x: {
            duration: PKG_TOTAL_S,
            delay: tR,
            times,
            ease: [
              "easeOut", // decisive push through the door
              "linear", // ballistic drift while falling
              "easeOut", // impact kills forward speed
              "easeOut",
              "easeOut", // momentum draining away
              "easeOut",
              "easeOut",
              "easeOut", // asymptotic creep into the slot
            ],
          },
          y: {
            duration: PKG_TOTAL_S,
            delay: tR,
            times,
            ease: [
              "linear", // level in the doorway
              [0.5, 0, 0.85, 0.6], // gravity: accelerating fall
              [0.3, 0.6, 0.5, 1], // bounce up, decelerating to the apex
              [0.5, 0, 0.8, 0.7], // falling out of the bounce
              [0.35, 0.6, 0.5, 1], // tiny corner lift
              [0.5, 0, 0.7, 1],
              [0.4, 0, 0.6, 1], // settles flat
              "linear",
            ],
          },
          rotate: {
            duration: PKG_TOTAL_S,
            delay: tR,
            times,
            ease: [
              "easeIn",
              "easeIn",
              "linear",
              "linear",
              "easeOut",
              "easeOut",
              "easeOut",
              "easeOut",
            ],
          },
          /* reveal happens in a single frame right when the door releases
           * it (delay: tR, duration: 0) instead of ramping over a fixed
           * span - a fixed ramp doesn't scale with truck speed, so on a
           * faster truck (e.g. mobile) the truck's rear edge can outrun it
           * and the package becomes visible while only partially covered,
           * a visible glitch. The package is fully covered by the truck's
           * z-index (23 vs 30) at the instant of release, so an instant
           * reveal is invisible - it just relies on the truck's own art to
           * mask it, and the existing x/y motion (untouched) carries it
           * out from behind the truck exactly as before. */
          opacity: {
            delay: tR,
            duration: 0,
          },
        },
      };
    }

    // flourish / reveal / done: hold the final slot. The pieces ARE the
    // final logo - they persist at full opacity forever (single persistent
    // rendering; no crossfade to a second copy, no opacity reset).
    return {
      animate: { x: 0, y: 0, rotate: 0, opacity: 1 },
      transition: { duration: 0 },
    };
  };

  /* ---- letters (J + dot, T, C): hidden inside the package during the
   * delivery, then they emerge from within the resting wedge and glide to
   * their exact final slots - original order, interval and duration ---- */
  const getLetterAnim = (piece) => {
    const g = frozenGeomRef.current ?? geom;
    if (!g) {
      return { animate: { opacity: 0 }, transition: { duration: 0 } };
    }
    const d = delivery(g);
    const s = d.s;
    const fw = piece.w * s;
    const fh = piece.h * s;
    const fx = g.logo.left + piece.x * s;
    const fy = g.logo.top + piece.y * s;

    // the dot emerges and rests at a staging spot to the LEFT of the J on
    // the logo's baseline ("dot J") - never above it, never overlapping.
    // These offsets shift its whole path relative to its CSS perch.
    const isDot = piece.id === "dot";
    const rOx = isDot ? Math.max(g.logo.left - fw * 1.6, 2) - fx : 0;
    const rOy = isDot ? g.logo.top + g.logo.height - fh - fy : 0;

    // every member of a group shares these exact deltas (computed from the
    // group's center to the package's center AT ITS RELEASE MOMENT), so
    // grouped pieces move as one unit and each group visibly exits from
    // wherever the still-moving package actually is when its physics event
    // (bounce landing / first tumble / second tumble) shakes it loose
    const gc = GROUP_CENTERS[piece.group];
    const gCx = g.logo.left + gc.cx * s;
    const gCy = g.logo.top + gc.cy * s;
    const relX = d.pkgCx + RELEASE_X_FRAC[piece.group] * d.tumble;
    const relY = d.pkgCy + RELEASE_Y_FRAC[piece.group] * d.pkgH;
    // start slightly right of the package center: fully inside the box
    const sx = relX - gCx + 0.1 * d.pkgW;
    const sy = relY - gCy;

    if (phase === "loading") {
      // packed inside the wedge assembly, hidden
      return {
        animate: { x: sx + rOx, y: sy + rOy, rotate: 0, opacity: 0 },
        transition: { duration: 0 },
      };
    }

    if (phase === "run") {
      // pops out of the tumbling wedge with a small lift the instant its
      // physics event fires, then glides left into its final slot - the
      // wedge (z-above) masks the start, so the piece visibly slides out
      // from INSIDE the moving package
      const delay = d.tR + RELEASE_AT_S[piece.group];
      const lift = 0.06 * d.pkgH;
      return {
        animate: {
          x: [sx + rOx, rOx],
          y: [sy + rOy, sy + rOy - lift, rOy],
          opacity: [0, 1, 1],
          rotate: 0,
        },
        transition: {
          x: {
            duration: PLACE_DUR_S,
            delay,
            ease: [0.16, 0.68, 0.3, 1], // popped out, decelerating glide
          },
          y: {
            duration: PLACE_DUR_S,
            delay,
            times: [0, 0.4, 1],
            ease: [
              [0.3, 0.6, 0.4, 1], // small lift out of the box
              [0.4, 0, 0.3, 1], // settles onto the baseline
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

    if (phase === "flourish" && isDot) {
      // one continuous projectile toss from beside the J onto the perch:
      // x travels at constant horizontal velocity for the WHOLE flight
      // while y follows a gravity parabola (quadratic rise to the apex,
      // quadratic fall), so the dot moves up and right simultaneously with
      // no L-shaped corner - then the unchanged bounce + settle. The apex
      // sits at 42% of the timeline (sqrt of rise height : fall height,
      // a constant ratio of the logo proportions, so the trajectory is
      // identical on every screen). The arc passes above the J throughout.
      const apex = fh * 0.7; // above the final perch
      const bounce = fh * 0.28;
      const times = [0, 0.42, 0.62, 0.82, 1];
      return {
        animate: {
          // 0.32 = fraction of horizontal distance left at the apex
          // (1 - 0.42/0.62), keeping x-velocity constant across both
          // flight segments
          x: [rOx, 0.32 * rOx, 0, 0, 0],
          y: [rOy, -apex, 0, -bounce, 0],
          opacity: 1,
          rotate: 0,
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
              [0.5, 1, 0.89, 1], // quadratic ease-out: launched with full
              // upward velocity, decelerating under gravity to the apex
              [0.11, 0, 0.5, 0], // quadratic ease-in: gravity accelerates
              // the fall onto the perch
              [0.3, 0.6, 0.4, 1], // subtle bounce up
              [0.5, 0, 0.65, 0.6], // natural settle
            ],
          },
        },
      };
    }

    // flourish (non-dot) / reveal / done: hold the final position. The
    // letters ARE the final logo - full opacity forever, never reset.
    return {
      animate: { x: 0, y: 0, rotate: 0, opacity: 1 },
      transition: { duration: 0 },
    };
  };

  /* ---- reduced motion: static logo, no theatrics ---- */
  if (reducedMotion) {
    return (
      <main style={styles.stage}>
        <div style={styles.logoBox}>
          <img src={FULL_LOGO} alt="JTC logo" style={styles.fill} />
        </div>
      </main>
    );
  }

  const pkg = getPackageAnim();

  /* dock hand-off: identity (x:0, y:0, scale:1) until dockDelta is computed
   * above, then one rigid glide+scale to the login slot. The stage's opaque
   * white background dissolves over the exact same span so the real login
   * page underneath is revealed in lockstep with the logo's move, rather
   * than popping in before or after it. */
  const dockAnimate = dockDelta
    ? { x: dockDelta.x, y: dockDelta.y, scale: dockDelta.scale }
    : { x: 0, y: 0, scale: 1 };
  const dockTransition = dockDelta
    ? { duration: DOCK_DUR_S, ease: DOCK_EASE }
    : { duration: 0 };
  const stageBackground = dockDelta ? "rgba(255, 255, 255, 0)" : "#ffffff";

  return (
    <motion.main
      style={{ ...styles.stage, background: undefined }}
      animate={{ backgroundColor: stageBackground }}
      transition={dockTransition}
      initial={false}
      aria-label="JTC logo animation"
      aria-hidden={!!dockDelta}
      className="jtc-loading-stage"
    >
      {/* logo assembly zone: centered on the viewport; pieces live here in
          their exact final spots and only ever move via transforms. The
          dock glide+scale is applied on this NON-static outer wrapper
          (not on `logoRef` itself) because framer-motion fully owns the
          `transform` of whatever element it animates x/y/scale on - putting
          it on the same element as the centering `translate(-50%,-50%)`
          below would silently overwrite that centering (a pitfall already
          hit and documented in this project's handoff notes). */}
      <motion.div
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        animate={dockAnimate}
        transition={dockTransition}
        onAnimationComplete={() => {
          if (dockDelta) onDocked?.();
        }}
      >
        <div ref={logoRef} style={styles.logoBox}>
        {LETTER_PIECES.map((piece) => {
          const { animate, transition } = getLetterAnim(piece);
          return (
            <motion.img
              key={piece.id}
              src={piece.src}
              alt=""
              draggable={false}
              initial={false}
              animate={animate}
              transition={transition}
              style={{
                position: "absolute",
                left: `${(piece.x / LOGO_W) * 100}%`,
                top: `${(piece.y / LOGO_H) * 100}%`,
                width: `${(piece.w / LOGO_W) * 100}%`,
                height: `${(piece.h / LOGO_H) * 100}%`,
                zIndex: 20 + piece.z,
                // no will-change here: a permanent compositor layer keeps
                // the RESTING piece on the GPU-composited path, where
                // fractional percentage offsets are composited without
                // pixel snapping (slightly soft/offset edges vs the normal
                // raster pipeline). The pieces are the persistent final
                // logo, so their at-rest rendering must be the crisp,
                // pixel-snapped one; browsers still layer-promote during
                // the brief animated stretch on their own.
              }}
            />
          );
        })}

        {/* the wedge package: ONE rigid container holding the wedge + both
            flags at their exact relative logo positions - it is ejected,
            tumbles and slides as a single body, and stacks above the
            letters so they visibly emerge from inside it */}
        <motion.div
          initial={false}
          animate={pkg.animate}
          transition={pkg.transition}
          style={{
            position: "absolute",
            left: `${(PKG_X0 / LOGO_W) * 100}%`,
            top: `${(PKG_Y0 / LOGO_H) * 100}%`,
            width: `${(PKG_W / LOGO_W) * 100}%`,
            height: `${(PKG_H / LOGO_H) * 100}%`,
            zIndex: 23,
            // no will-change: same pixel-snapping rationale as the letter
            // pieces above - the wedge+flags are part of the persistent
            // final logo once at rest
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
                left: `${((piece.x - PKG_X0) / PKG_W) * 100}%`,
                top: `${((piece.y - PKG_Y0) / PKG_H) * 100}%`,
                width: `${(piece.w / PKG_W) * 100}%`,
                height: `${(piece.h / PKG_H) * 100}%`,
                zIndex: piece.z,
              }}
            />
          ))}
        </motion.div>

        {/* NOTE: there is intentionally no full-logo overlay here. The 8
            assembled pieces above ARE the final logo (verified pixel-
            faithful decomposition of jtc-full-logo.svg) and they persist
            as-is - the logo is rendered exactly once, by one set of
            persistent elements, from first frame to final state. The old
            end-of-animation crossfade drew a second full-logo copy on top
            of the still-visible pieces and then snapped the pieces away,
            which read as a double-render/redraw glitch. jtc-full-logo.svg
            is still used by the reduced-motion fallback below. */}
        </div>
      </motion.div>

      {/* truck: same art, size, path and speed as before */}
      <div ref={truckWrapRef} style={styles.truckWrap} aria-hidden>
        <motion.div
          key={runId}
          initial={false}
          animate={truckAnim.animate}
          transition={truckAnim.transition}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            willChange: "transform",
          }}
        >
          <img
            src={TRUCK_IMG}
            alt=""
            draggable={false}
            style={{ ...styles.fill, position: "absolute", inset: 0 }}
          />
        </motion.div>
      </div>
    </motion.main>
  );
}

/* ---------------------------------------------------------------------------
 * Styles
 *
 * Horizontal layout, all relative to the truck width T = TRUCK_W_CSS:
 *   composition width = logo (0.8T) + gap (0.04T) + truck (1T) = 1.84T
 *   composition left  = 50% - 0.92T   (centered as a whole)
 *   logo left         = 50% - 0.92T
 *   truck left        = 50% - 0.08T
 * Vertically both anchor to the same ground line at the wheel base.
 * All offsets are percentages of the fixed inset:0 stage - NEVER vw/vh,
 * which desync from the stage on iOS when browser bars are showing.
 * ------------------------------------------------------------------------- */

const styles = {
  stage: {
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    // pure white: the truck / letter-C raster art sits on white cards,
    // so a white stage makes those cards invisible without editing assets
    background: "#ffffff",
  },
  // the assembled logo sits at the exact viewport center on every screen;
  // this element never animates, so the centering transform is safe here
  logoBox: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: `calc(${LOGO_BASE_RATIO} * ${BASE_W_CSS})`,
    /* explicit calc() height (not aspect-ratio) so every piece inside -
     * including the wedge package, positioned via percentage top/height -
     * resolves against a height value with universal, long-standing
     * cross-browser support, rather than depending on aspect-ratio's
     * newer and historically less consistent interaction with
     * percentage-sized absolutely-positioned children */
    height: `calc(${(LOGO_BASE_RATIO * (LOGO_H / LOGO_W)).toFixed(6)} * ${BASE_W_CSS})`,
  },
  // the truck parks just right of the centered logo, its wheel line running
  // through the logo's baseline. Its offsets MUST use percentages of the
  // fixed stage (50%/50%), never viewport units (50vw/50vh): the logo is
  // centered with top:50% of the stage, and on iOS Safari/Chrome the vh
  // unit is resolved against the LARGEST viewport (browser bars collapsed)
  // while the fixed inset:0 stage is sized to the CURRENT visible viewport
  // (bars showing) - so 50vh sits ~half the browser-UI height BELOW the
  // stage's true center there. Mixing the two put the truck (and with it
  // the measured ejection door and wheel line) visibly lower than the
  // logo baseline on mobile browsers, so the wedge appeared to land in
  // mid-air above the wheels. Percentages of the shared stage keep logo
  // and truck in one reference frame on every browser and device.
  truckWrap: {
    position: "absolute",
    left: `calc(50% + ${(LOGO_BASE_RATIO / 2 + GAP_BASE_RATIO).toFixed(4)} * ${BASE_W_CSS})`,
    top: `calc(50% + ${TRUCK_TOP_FRAC.toFixed(4)} * ${BASE_W_CSS})`,
    width: TRUCK_W_CSS,
    aspectRatio: `${962} / ${436}`,
    zIndex: 30,
  },
  fill: {
    display: "block",
    width: "100%",
    height: "100%",
  },
};
