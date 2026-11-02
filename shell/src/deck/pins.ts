// Apps pinned under the Home map, each one press from open. A pin is an Apps
// row's id (stage/menu.tsx); omarchy-pocketd keeps the list in
// ~/.local/state/omarchy-pocket/pins.json. Until something is pinned or
// unpinned the row holds DEFAULT_PINS, those of them this device has. Home
// edits them in place (deck/home.tsx); the menu pins and unpins its selected
// app too (Y, or the function row's Pin).
import { createSignal } from "solid-js";
import { request } from "../bridge.ts";
import type { MenuItem } from "../menu.ts";
import { toast } from "../stage/toasts.tsx";

export const MAX_PINS = 6;
export const PIN = "\u{f0403}";
export const UNPIN = "\u{f0404}";
const DEFAULT_PINS = ["Terminal", "Agent", "YouTube", "X", "GitHub", "Weather"];

/** the saved ids, or null while nothing has been chosen */
const [saved, setSaved] = createSignal<string[] | null>(null);
void request<string[] | null>({ method: "pins" }).then(setSaved, () => {});

/** An Apps row: Terminal, Agent, an applet, a package or a terminal program. */
export const pinnable = (item: MenuItem | undefined): item is MenuItem => !!item && item.id.startsWith("apps.");

/** The pinned ids that `apps` (the Apps rows) holds, in order. */
export function pinIds(apps: readonly MenuItem[]): string[] {
  const chosen = saved() ?? DEFAULT_PINS.flatMap((label) => apps.find((a) => a.label.toLowerCase() === label.toLowerCase())?.id ?? []);
  return apps.length ? chosen.filter((id) => apps.some((a) => a.id === id)) : chosen;
}

export function togglePin(item: MenuItem, apps: readonly MenuItem[]) {
  const now = pinIds(apps);
  if (now.includes(item.id)) return save(now.filter((id) => id !== item.id));
  if (now.length >= MAX_PINS) return toast({ icon: PIN, title: `Home holds ${MAX_PINS} pins`, body: "Unpin one to make room", tone: "info" });
  save([...now, item.id]);
}

function save(ids: string[]) {
  setSaved(ids);
  void request({ method: "pinsSet", ids }).catch(() => {});
}
