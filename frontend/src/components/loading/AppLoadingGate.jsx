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
 *      the app boots. The welcome plays on the FIRST load of the tab
 *      unconditionally (regardless of the landing URL), and then re-plays
 *      only when the user REFRESHES /login. Refreshing or deep-linking to
 *      any other route (/dashboard, an admin page, etc.) after that first
 *      load skips the animation entirely: the gate returns children
 *      directly, no overlay is mounted, no assets preload, no dock provider
 *      is exposed.
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
 *   4. Once docked, the overlay - and with it the EXACT logo instance the
 *      user has been watching since the first loading frame - stays
 *      mounted, parked over the login slot, while the login UI reveals
 *      beneath it. The login page's own static logo stays hidden. There is
 *      no unmount, no remount, no swap and no opacity change of any logo
 *      element at the landing instant, so there is nothing that can
 *      flicker. The overlay is only "retired" (static logo revealed +
 *      overlay removed, atomically in one React commit) at a moment where
 *      that single swap frame physically cannot be perceived: the login
 *      page unmounting after a successful sign-in, or a resize / rotation /
 *      scroll - events the parked position:fixed logo could not track
 *      anyway - whose own reflow hides the frame.
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

// Session-scoped flag: the truck-delivery animation is intended as a
// once-per-visit welcome, not something the user re-watches on every
// full-page reload during the same browser session. sessionStorage matches
// this exactly — it persists for the lifetime of the tab / window but is
// cleared automatically when the tab closes, so returning to the app in a
// fresh tab (or a new day) plays the animation again while a reload during
// the current session skips straight to the app.
const LOADING_PLAYED_KEY = "jtc_loading_played";

function loadingAlreadyPlayed() {
  try {
    return window.sessionStorage.getItem(LOADING_PLAYED_KEY) === "1";
  } catch (_) {
    // Storage disabled / privacy mode — err on the side of playing the
    // animation rather than silently swallowing it forever.
    return false;
  }
}

function markLoadingPlayed() {
  try {
    window.sessionStorage.setItem(LOADING_PLAYED_KEY, "1");
  } catch (_) {
    // Failing to persist just means the next reload will replay — harmless.
  }
}

// Login-page refresh detection. Read against the URL the browser actually
// loaded (window.location, synchronously at gate mount - before
// BrowserRouter has resolved anything), so it reflects the true HTTP load
// target and cannot be confused with a later client-side navigation. Only
// consulted for SUBSEQUENT loads in the tab (i.e. once the once-per-session
// flag is already set); the very first load in the tab always plays the
// animation, whatever the initial URL, so app-boot behaviour is preserved.
const LOGIN_PATH = "/login";
function initialPathIsLogin() {
  try {
    return window.location.pathname === LOGIN_PATH;
  } catch (_) {
    // Non-browser environments (SSR test harness, etc.) - safest to skip
    // rather than force the animation onto a page that can't host it.
    return false;
  }
}
// Reduced-motion users get the component's own static-logo fallback frame
// (unchanged), just for a short, fixed grace period instead of forever - the
// ported component intentionally never advances its phase machine in that
// mode, so nothing internal to it will ever call onComplete.
const REDUCED_MOTION_GRACE_MS = 500;
// Fallback-path fade (used only when there is no dock target to fly to).
const FADE_MS = 220;

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
  // Decide once, at mount, whether to skip the welcome animation entirely.
  // Evaluated lazily inside useState so no render / route change / remount
  // can re-arm it after the gate has decided:
  //   - First load in this tab (sessionStorage flag not yet set): PLAY,
  //     regardless of the landing URL. This is the original app-boot
  //     behaviour and covers a fresh tab opening on /login, on /dashboard
  //     via a valid session, on a deep-linked route, etc.
  //   - Subsequent load in this tab (flag already set): a refresh or hard
  //     navigation. PLAY only when the initial URL is /login (the user has
  //     refreshed the login page); SKIP for every other path (refreshing
  //     /dashboard, /procurement, an admin page, etc.). Client-side pushes
  //     within the same tab (Sign Out → /login, session-expiry redirect
  //     to /login) do NOT remount the gate and therefore cannot re-trigger
  //     the animation - the gate is mounted exactly once, above the router
  //     in src/index.js.
  const [skip] = useState(() => {
    if (!loadingAlreadyPlayed()) return false;
    return !initialPathIsLogin();
  });

  const [visible, setVisible] = useState(!skip);
  const [fading, setFading] = useState(false); // fallback-path fade only
  const [dockRect, setDockRect] = useState(null);
  // The dock transform has landed: the login page may start its staged UI
  // reveal beneath the parked overlay logo.
  const [revealed, setRevealed] = useState(false);
  // The login page's own static logo should render. Deliberately a SEPARATE
  // signal from `revealed`: the overlay's assembled pieces remain the one
  // and only visible logo instance from the first loading frame, through
  // the dock glide, and across the entire login UI reveal. The static image
  // takes over only at retirement (see retireOverlay below).
  const [logoVisible, setLogoVisible] = useState(false);
  const [docked, setDocked] = useState(false); // landing confirmed - overlay is now just a parked logo

  const assembledRef = useRef(false); // guards handleAssembled against double calls
  const finishedRef = useRef(false); // dock landed OR fallback taken - each blocks the other path
  const retiredRef = useRef(false); // overlay permanently removed - guards retirement against double calls
  const slotRef = useRef(null);

  // Retire the overlay: reveal the login page's static logo and remove the
  // overlay in the SAME React commit (both states live here and React
  // batches them), so the swap between the two pixel-aligned, same-art
  // renderings is one single frame with no gap and no stacked duplicate.
  // Crucially this is only ever invoked at moments where even that one
  // frame cannot be seen - never while the user is watching the logo sit
  // still on an otherwise idle login page.
  const retireOverlay = useCallback(() => {
    if (retiredRef.current) return;
    retiredRef.current = true;
    finishedRef.current = true;
    markLoadingPlayed();
    setLogoVisible(true);
    setRevealed(true);
    setVisible(false);
  }, []);

  const registerSlot = useCallback((el) => {
    slotRef.current = el;
    // Slot unregistered after the hand-off began => the login page is
    // unmounting (successful sign-in navigating away). The overlay's fixed
    // logo must not linger over the next screen, so retire it. Deferred one
    // microtask so an unregister/re-register churn inside a single commit
    // (StrictMode double-invoke, an effect re-run) is not mistaken for a
    // real unmount - by the time the microtask runs, a churn has already
    // re-registered the slot and the retirement is skipped.
    if (!el && assembledRef.current) {
      Promise.resolve().then(() => {
        if (!slotRef.current) retireOverlay();
      });
    }
  }, [retireOverlay]);

  // Fallback path: no dock target available (or an error/timeout/reduced-
  // motion case) - just fade the whole cover away, exactly as before. Also
  // flips the login page's own static logo to visible (same as the
  // successful-dock path) - without this, a session that never docks would
  // fade the cover away onto a login page permanently missing its logo.
  const fallbackFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    retiredRef.current = true; // no parked logo on this path - nothing left to retire
    markLoadingPlayed();
    setLogoVisible(true);
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
  // Nothing is unmounted, recreated, swapped, faded or re-styled at this
  // instant: the overlay - and with it the exact logo instance that just
  // glided in - simply stays where it is, and `revealed` lets the login UI
  // cascade in beneath it. With no DOM mutation touching the logo at the
  // landing moment, there is nothing that can flicker, redraw or shift.
  const handleDocked = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markLoadingPlayed();
    setDocked(true);
    setRevealed(true);
    // Nudge the (still hidden, already preloaded) static logo image to
    // decode now, in the background, so the eventual retirement swap can
    // never paint a blank frame while the browser lazily decodes it.
    try {
      slotRef.current?.querySelector?.("img")?.decode?.().catch(() => {});
    } catch (_) {
      // best-effort optimisation only - retirement still works without it
    }
  }, []);

  // The parked overlay logo is position:fixed, so it cannot track the login
  // slot through any layout change. A resize, an orientation change, or a
  // scroll (e.g. the login page overflowing a short viewport) therefore
  // retires it immediately - the swap frame is hidden inside the reflow /
  // scroll repaint the browser is performing at that same moment, and the
  // static in-flow logo takes over tracking the layout from then on. Armed
  // from the instant the dock glide starts, so even a resize that lands
  // mid-flight resolves to a correctly positioned logo.
  useEffect(() => {
    if (!dockRect || !visible) return undefined;
    const onLayoutChange = () => retireOverlay();
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("orientationchange", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("orientationchange", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, { capture: true });
    };
  }, [dockRect, visible, retireOverlay]);

  useEffect(() => {
    // Nothing to time out or grace-period when the animation isn't going to
    // play at all this session - arming these timers would just risk a stray
    // setState against an unmounted overlay path.
    if (skip) return undefined;

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
  }, [fallbackFinish, skip]);

  const dockContextValue = useMemo(
    () => ({ registerSlot, revealed, logoVisible }),
    [registerSlot, revealed, logoVisible],
  );

  // Subsequent visits within the same browser session: the animation already
  // played once in this tab, so we render the app directly with no overlay
  // and no dock provider. Passing `null` (via the default context value) lets
  // the login page render immediately with its own static logo visible, since
  // it explicitly treats `dock === null` as "no gating - show now."
  if (skip) return children;

  return (
    <LogoDockContext.Provider value={dockContextValue}>
      {children}
      {visible && (
        <div
          aria-hidden={fading || !!dockRect}
          style={{
            position: "fixed",
            inset: 0,
            // While the animation plays the overlay must cover everything;
            // once the logo has parked it is nothing but a passive logo
            // layer over an interactive page, so it drops below the app's
            // dialog/toast layers (the login page's modal renders at z-50)
            // while staying above the page content. A z-index change alone
            // repaints nothing - the logo pixels are untouched by it.
            zIndex: docked ? 10 : 2147483647,
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
