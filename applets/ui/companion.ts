// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/companion.ts — the computer the applets reach, as their prose
// names it. Omarchy Pocket: the services run on this device, in
// omarchy-pocketd (daemon/companion.ts), so every string names this device;
// on a 3DS they named the paired Mac or the tethered companion.

/** The services run on the computer the applet runs on. */
export function tethered(): boolean {
  return true;
}

/** "this device" */
export const yourComputer = (): string => "this device";

/** "This device", to start a sentence. */
export const theComputer = (): string => "This device";

/** Where a service keeps the files that sign it in (the Mac's Pocket
 *  Companion store copied over). */
export const SERVICE_STORE = "~/.local/share/omarchy-pocket/companion/services";

/** What a reader sees when the daemon does not answer. */
export function notLinked(app: string, verb = "loads"): { title: string; detail: string } {
  return { title: "omarchy-pocketd is not answering", detail: `${app} ${verb} through omarchy-pocketd on this device. Check it with: systemctl status omarchy-pocketd` };
}
