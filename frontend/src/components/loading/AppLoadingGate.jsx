import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JTCLogoAnimation from "./JTCLogoAnimation";
import { LogoDockContext } from "./LogoDockContext";
import "./jtc-loading.css";

/* ---------------------------------------------------------------------------
 * AppLoadingGate
 *
 * Integration wrapper around the reused JTC loading animation. It owns
 * nothing about the animation itself (no timing, motion, easing, asset or
 * styling decision lives here) - its only job is:
 *   1. Show JTCLogoAnimation full-screen, on top of everything, the instant
 *      the app boots.
 *   2. Let the real app mount underneath at the same time (so auth/session
 *      restore already runs while the animation plays instead of only
 *      starting after it).
 *   3. The instant the logo finishes assembling, measure the login page's
 *      brand-logo slot (already mounted underneath, just covered) and hand
 *      that rect to JTCLogoAnimation as `dockRect` - the already-assembled
 *      logo then glides/scales itself into that exact box as one continuous
 *      motion while the opaque cover dissolves around it, so the loading
 *      screen and the login page read as a single uninterrupted animation
 *      rather than two screens with a cut between them.
 *   4. Once docked, flip the login page's own static logo to visible in
 *      that same spot (same asset, same position/size - imperceptible) and
 *      unmount the overlay a beat later, by which point its background is
 *      already fully transparent and there is nothing left to visibly
 *      remove.
 *   5. Never show the loading screen again for the lifetime of this page
 *      load: it is mounted exactly once, in src/index.js, above <App />.
 *      A client-side route change (e.g. login -> dashboard) never remounts
 *      it because App itself never remounts.
 *   6. Fail open: any exception thrown while rendering the animation, an
 *      OS-level "reduce motion" preference (under which the ported
 *      component's phase machine never leaves "loading", by its own
 *      original design), or simply no login slot being registered (e.g. an
 *      already-authenticated session that lands straight on /dashboard
 *      instead of /login) all fall back to a plain opacity fade of the
 *      whole cover instead of ever attempting - or blocking on - a dock
 *      that has nowhere to land. That fallback still flips the login
 *      page's static logo to visible (same signal as a successful dock),
 *      so a login screen that goes through this path is never left
 *      missing its own logo.
 * ------------------------------------------------------------------------- */

// Belt-and-suspenders timeout: the animation's own asset-preload race already
// resolves within 6s worst case, and the full sequence is a few seconds on
// top of that. If completion still hasn't fired well beyond that (a hung
// tab, an unforeseen exception swallowed somewhere, etc.) this guarantees the
// login page is never blocked indefinitely.
const HARD_TIMEOUT_MS = 15000;
// Reduced-motion users get the component's own static-logo fallback frame
// (unchanged), just for a short, fixed grace period instead of forever - the
// ported component intentionally never advances its phase machine in that
// mode, so nothing internal to it will ever call onComplete.
const REDUCED_MOTION_GRACE_MS = 500;
// Fallback-path fade (used only when there is no dock target to fly to).
const FADE_MS = 220;
// After the dock transform lands, give the login page's own static logo one
// paint to appear in the exact same spot before the (by-then fully
// transparent) overlay is removed - belt-and-suspenders against any single-
// frame timing jitter between the two.
const POST_DOCK_MS = 60;

class LoadingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { errored: false };
  }
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch(error, info) {
    console.error("[AppLoadingGate] loading animation failed, skipping to app", error, info?.componentStack);
    this.props.onError?.();
  }
  render() {
    if (this.state.errored) return null;
    return this.props.children;
  }
}

export default function AppLoadingGate({ children }) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false); // fallback-path fade only
  const [dockRect, setDockRect] = useState(null);
  const [revealed, setRevealed] = useState(false); // login's own static logo should show

  const assembledRef = useRef(false); // guards handleAssembled against double calls
  const finishedRef = useRef(false); // guards the final unmount against double calls
  const slotRef = useRef(null);

  const registerSlot = useCallback((el) => {
    slotRef.current = el;
  }, []);

  // Fallback path: no dock target available (or an error/timeout/reduced-
  // motion case) - just fade the whole cover away, exactly as before. Also
  // flips the login page's own static logo to visible (same as the
  // successful-dock path) - without this, a session that never docks would
  // fade the cover away onto a login page permanently missing its logo.
  const fallbackFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setRevealed(true);
    setFading(true);
    window.setTimeout(() => setVisible(false), FADE_MS);
  }, []);

  // Fires once, when the ported assembly timeline reaches "done".
  const handleAssembled = useCallback(() => {
    if (assembledRef.current) return;
    assembledRef.current = true;
    const rect = slotRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      setDockRect(rect);
    } else {
      fallbackFinish();
    }
  }, [fallbackFinish]);

  // Fires once, when the logo has physically landed in the login slot.
  const handleDocked = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setRevealed(true);
    window.setTimeout(() => setVisible(false), POST_DOCK_MS);
  }, []);

  useEffect(() => {
    const timers = [window.setTimeout(fallbackFinish, HARD_TIMEOUT_MS)];

    let reducedMotion = false;
    try {
      reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reducedMotion = false;
    }
    if (reducedMotion) {
      timers.push(window.setTimeout(fallbackFinish, REDUCED_MOTION_GRACE_MS));
    }

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [fallbackFinish]);

  const dockContextValue = useMemo(
    () => ({ registerSlot, revealed }),
    [registerSlot, revealed],
  );

  return (
    <LogoDockContext.Provider value={dockContextValue}>
      {children}
      {visible && (
        <div
          aria-hidden={fading || !!dockRect}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            opacity: fading ? 0 : 1,
            transition: fading ? `opacity ${FADE_MS}ms ease-out` : undefined,
            // once a dock target is found, the real page is being revealed
            // right underneath as the cover dissolves - let clicks/typing
            // reach it immediately instead of waiting for that to finish
            pointerEvents: fading || dockRect ? "none" : "auto",
          }}
        >
          <LoadingErrorBoundary onError={fallbackFinish}>
            <JTCLogoAnimation
              onComplete={handleAssembled}
              dockRect={dockRect}
              onDocked={handleDocked}
            />
          </LoadingErrorBoundary>
        </div>
      )}
    </LogoDockContext.Provider>
  );
}
