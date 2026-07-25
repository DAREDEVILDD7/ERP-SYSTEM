import { createContext } from "react";

/* Bridges the login page's brand-logo slot (deep inside the router, mounted
 * from the app's very first paint) with AppLoadingGate (mounted once, in
 * src/index.js, outside the router) so the loading animation's already-
 * assembled JTC logo knows exactly where on the login page to dock, without
 * prop-drilling through every route.
 *
 * Value shape: { registerSlot(el | null), revealed }
 *  - registerSlot: called by the login page with the DOM node that reserves
 *    its brand-logo box, so AppLoadingGate can measure it once the loading
 *    animation finishes assembling. Called with null on unmount.
 *  - revealed: true once the docking transform has landed exactly on that
 *    slot - the login page uses it to switch its own static logo image from
 *    invisible to visible at that exact instant (same position, same asset,
 *    so the hand-off from the animated element to the static one is not
 *    perceptible).
 *
 * Defaults to null so anything rendering outside AppLoadingGate (tests, a
 * future standalone render of the page) degrades safely rather than hanging
 * on a docking signal that will never arrive.
 */
export const LogoDockContext = createContext(null);
