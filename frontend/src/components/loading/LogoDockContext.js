import { createContext } from "react";

/* Bridges the login page's brand-logo slot (deep inside the router, mounted
 * from the app's very first paint) with AppLoadingGate (mounted once, in
 * src/index.js, outside the router) so the loading animation's already-
 * assembled JTC logo knows exactly where on the login page to dock, without
 * prop-drilling through every route.
 *
 * Value shape: { registerSlot(el | null), revealed, logoVisible }
 *  - registerSlot: called by the login page with the DOM node that reserves
 *    its brand-logo box, so AppLoadingGate can measure it once the loading
 *    animation finishes assembling. Called with null on unmount - the gate
 *    interprets this (once assembly has already fired) as the login page
 *    navigating away, and uses it as the trigger to retire its parked
 *    overlay logo.
 *  - revealed: true once the docking transform has landed exactly on that
 *    slot - the login page uses it to start its own staged UI reveal
 *    (heading/card/link/footer) beneath the parked overlay logo. It does
 *    NOT flip the login's own static logo to visible any more; that is now
 *    a separate signal (see `logoVisible`).
 *  - logoVisible: true only at the gate's retirement moment - when the
 *    parked overlay logo is being removed in the same React commit as the
 *    static one becoming opaque. This is deliberately delayed until an
 *    imperceptible moment (login page unmount on sign-in, or a resize /
 *    orientation change / scroll that reflows the page anyway), so that
 *    across the entire visible span from the first loading frame through
 *    the docked, staged login reveal, the user sees exactly ONE logo
 *    instance - the overlay's assembled pieces - never a swap between two
 *    stacked renderings.
 *
 * Defaults to null so anything rendering outside AppLoadingGate (tests, a
 * future standalone render of the page) degrades safely rather than hanging
 * on a docking signal that will never arrive.
 */
export const LogoDockContext = createContext(null);
