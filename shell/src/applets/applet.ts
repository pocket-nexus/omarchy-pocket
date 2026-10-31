// The shell's own applets: programs that open as windows on the stage,
// inside the shell's package. An applet draws in its window at the size the
// tiling gives it and is driven by keys: the gamepad's plain buttons and
// the deck's keyboard, which type the same keys (keys.ts). An applet takes
// buttons (`press`), or a sink of its own while it edits text (`keys`,
// Notes). It hears when its window comes onto the current workspace and
// leaves it, so it polls the daemon only while it can be seen.
import type { JSX } from "solid-js";
import type { KeySink } from "../keys.ts";
import { closeWindow, find, focused, focusWindow, open, type Win } from "../workspaces.ts";

export interface Applet {
  id: string;
  title: string;
  icon: string;
  /** the window's content, w x h points inside its border */
  Stage: (props: { w: number; h: number; focused: boolean }) => JSX.Element;
  /** plain gamepad buttons, and the keys that stand for them (keys.ts BUTTON_KEYS) */
  press?(key: number): void;
  /** where the keyboard types while the applet edits text */
  keys?(): KeySink | null;
  /** the line above the keys: what the keys do here */
  hint?(): string;
  /** the window is on the current workspace */
  shown?(): void;
  hidden?(): void;
}

const registry = new Map<string, Applet>();

export function register(applet: Applet) {
  registry.set(applet.id, applet);
}

export const applets = () => [...registry.values()];
export const appletById = (id: string) => registry.get(id);
export const appletOf = (w: Win | null) => (w?.kind === "applet" ? registry.get(w.applet) : undefined);

/** The applet in the focused window, if the window is one. */
export const focusedApplet = () => appletOf(focused());

const isApplet = (id: string) => (w: Win) => w.kind === "applet" && w.applet === id;

/** Focuses the applet's window (one per applet, on any workspace), or opens
 *  it on the current workspace beside the focused window. */
export function openApplet(id: string) {
  if (!registry.has(id)) return;
  const existing = find(isApplet(id));
  if (existing) return focusWindow(existing.id);
  open({ kind: "applet", applet: id });
}

export function closeApplet(id: string) {
  const existing = find(isApplet(id));
  if (existing) closeWindow(existing.id);
}
