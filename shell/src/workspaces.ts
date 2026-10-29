// The stage's windows as signals: wm.ts holds the tree, and every change
// goes through `act`, which bumps one revision signal that every reader
// tracks. A window is a Pocket Term session or one of the shell's applets;
// five workspaces, numbered 1 to 5 in the bar, each tile their windows in a
// dwindle tree.
import { createSignal } from "solid-js";
import { WindowManager, WORKSPACES, type Content, type Dir, type Placement, type Win } from "./wm.ts";

export { WORKSPACES };
export type { Content, Dir, Placement, Win };

const wm = new WindowManager();
const [rev, setRev] = createSignal(0);

/** Runs a change to the windows and lets the readers know. */
export function act<T>(change: (manager: WindowManager) => T): T {
  const out = change(wm);
  setRev((r) => r + 1);
  return out;
}

const read = <T>(get: (manager: WindowManager) => T) => () => {
  rev();
  return get(wm);
};

/** Tracks every change to the windows. */
export const revision = rev;

/** The current workspace, 0 to 4. */
export const current = read((m) => m.active);
/** The focused window on the current workspace. */
export const focused = read((m) => m.focused());
export const placements = read((m) => m.placements());
export const occupied = (ws: number) => read((m) => m.occupied(ws))();
export const fullscreen = read((m) => m.fullscreen());
/** Every window on the current workspace. */
export const visibleWindows = read((m) => m.order().map((id) => m.windows.get(id)!));
export const windowById = (id: number) => wm.windows.get(id) ?? null;
/** The windows of workspace `ws`, in tree order. */
export const windowsOn = (ws: number) => read((m) => m.order(ws).map((id) => m.windows.get(id)!))();
export const windowAt = (x: number, y: number) => wm.windowAt(x, y);
export const areaRect = () => wm.area();

export function find(match: (w: Win) => boolean): Win | null {
  return wm.find(match);
}

export function open(content: Content): number {
  return act((m) => m.open(content));
}

export function closeWindow(id: number) {
  act((m) => m.close(id));
}

export function focusWindow(id: number) {
  act((m) => m.focusWin(id));
}

export function focus(ws: number) {
  act((m) => m.switchWs(ws));
}

export function step(delta: number) {
  act((m) => m.stepWs(delta));
}
