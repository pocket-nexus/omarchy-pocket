// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/platform.tsx — what the kit takes from the device it runs on. The
// kit is the same on Omarchy Pocket and in Pocket Shell except for this file.
export { AppletSurface as Surface } from "@pocketjs/framework/applet";
export { companionService, fetch, NET_MAX_RESPONSE_BYTES } from "../lib/net.ts";
export { keyboardElsewhere } from "@pocketjs/framework/osk";
/** Epoch milliseconds. */
export const now = () => Date.now();
/** Query answers kept for going back to: the heap has room for many. */
export const QUERIES_KEPT = 64;
