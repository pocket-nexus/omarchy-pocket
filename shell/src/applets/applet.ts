// The shell's own applets: programs that open as windows on the stage and
// take the deck's body while focused, inside the shell's package. An applet
// is a touch program: its controls are on the deck and every one of them
// answers a tap; the gamepad belongs to the window manager (chords.ts), and
// an applet may also take plain D-pad and face buttons as shortcuts. Its
// stage view lays out in the window's size, whatever the tiling gives it.
// An applet hears when its window comes onto the current workspace and
// leaves it, so it polls the daemon only while it can be seen. A PocketJS
// package applet (Apps) takes both panels instead and runs in place of the
// shell.
import type { JSX } from "solid-js";
import type { KeySink } from "../term/keyboard.tsx";
import type { TouchFrame } from "../touch.ts";
import { closeWindow, find, focused, focusWindow, open, type Win } from "../workspaces.ts";

export interface Applet {
  id: string;
  title: string;
  icon: string;
  /** the window's content, w x h points inside its border */
  Stage: (props: { w: number; h: number; focused: boolean }) => JSX.Element;
  /** the deck's body while the window is focused (512 x BODY_H) */
  Deck: () => JSX.Element;
  /** plain gamepad buttons, as shortcuts for what the deck does by touch */
  press?(key: number): void;
  /** a tap on the deck's body */
  tap?(x: number, y: number): void;
  /** the body's fingers this frame, in place of `tap` (keyboards, scrolling lists) */
  touches?(frame: TouchFrame): void;
  /** where the touch keyboard types while the applet shows it */
  keys?(): KeySink | null;
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
