// PocketJS packages in the shell's windows. A package never runs in place of
// the shell: the host program runs it beside the shell in a Runtime of its
// own (host/src/children.rs), drawing its two displays into textures, and
// the shell's window shows the top one (an applet's: its touch surface, its
// UI); the deck's controls body shows its touch surface, or a touch gamepad
// when it has none. The window manager
// keeps the shoulders, L2/R2 and SELECT; the focused package gets the other
// buttons. A package off the current workspace is paused.
//
// An applet's page says what it can be pressed (`appTargets`, host
// children.rs): its rows and buttons on its touch surface, for the stage's
// pointer, and whether it is taking typed text, for the deck, which then
// brings up the keyboard and types into it (`appText`).
import { createSignal } from "solid-js";
import { onEvent } from "./bridge.ts";
import type { KeySink } from "./term/keyboard.tsx";
import { toast } from "./stage/toasts.tsx";
import { closeWindow, find, open, type Win } from "./workspaces.ts";
import { setBody } from "./deck/body.ts";

interface AppBridge {
  openApp(path: string): number;
  resizeApp(id: number, w: number, h: number): void;
  closeApp(id: number): void;
  showApp(id: number, visible: boolean): void;
  appInput(id: number, buttons: number, contacts: number[]): void;
  appTargets(id: number): number[];
  appText(id: number, kind: "text" | "key", text: string): void;
}
const host = (globalThis as { omarchyBridge?: Partial<AppBridge> }).omarchyBridge;

/** each package window's textures, top display then touch surface, once booted */
const [textures, setTextures] = createSignal<Record<number, number[]>>({});
export const appTextures = (id: number) => textures()[id] ?? null;

/** An applet's touch surface in its window: its size in logical points and
 *  the scale the window draws it at. */
export interface Fit {
  w: number;
  h: number;
  scale: number;
}
/** The applets' baseline surface (PocketJS contracts/spec/applet.ts: the 3DS
 *  touch screen) and their adaptive maximum. */
const BASELINE = [320, 240] as const;
const MAX = [640, 720] as const;
/** The smallest scale a window draws an applet at; a smaller tile refuses it. */
const MIN_SCALE = 0.6;

/** How a tile of w x h shows an applet: at its size when it holds the
 *  baseline; else at the baseline's scale with the tile's shape (a narrow
 *  tile gets a portrait layout); null below MIN_SCALE. */
export function fitSurface(w: number, h: number): Fit | null {
  if (w >= BASELINE[0] && h >= BASELINE[1]) return { w: Math.min(MAX[0], Math.floor(w)), h: Math.min(MAX[1], Math.floor(h)), scale: 1 };
  const scale = Math.min(w / BASELINE[0], h / BASELINE[1]);
  if (scale < MIN_SCALE) return null;
  return { w: Math.min(MAX[0], Math.round(w / scale)), h: Math.min(MAX[1], Math.round(h / scale)), scale };
}

/** the surface size each applet was last given; absent: refused (too small) or not yet sized */
const [sized, setSized] = createSignal<Record<number, Fit | null>>({});
export const appletFit = (id: number) => sized()[id];
/** An applet whose tile refuses it is paused, as one off the workspace is. */
export const appletRefused = (id: number) => sized()[id] === null;

/** Gives applet `id` the surface its tile fits; the host lays it out again. */
export function sizeApplet(id: number, fit: Fit | null) {
  const last = sized()[id];
  if (fit && last && fit.w === last.w && fit.h === last.h) return;
  if (fit === null && last === null) return;
  setSized((s) => ({ ...s, [id]: fit }));
  if (fit) host?.resizeApp?.(id, fit.w, fit.h);
}

/** One of an applet's targets on its touch surface: tapped (0) or dragged (1). */
export interface AppletTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: number;
}

/** each applet's targets as last read, and the frame they were read in */
const pages = new Map<number, { frame: number; targets: AppletTarget[] }>();
let frame = 0;
const [typingApp, setTypingApp] = createSignal<number | null>(null);

/** Once per frame, before the deck and the pointer ask. */
export function nextAppletFrame() {
  frame++;
}

/** Applet `id`'s targets, read from the host at most once a frame; asking
 *  keeps the host reading them. */
export function appletTargets(id: number): AppletTarget[] {
  const page = pages.get(id);
  if (page && page.frame === frame) return page.targets;
  const flat = host?.appTargets?.(id) ?? [];
  const targets: AppletTarget[] = [];
  for (let i = 1; i + 4 < flat.length; i += 5) targets.push({ x: flat[i]!, y: flat[i + 1]!, w: flat[i + 2]!, h: flat[i + 3]!, kind: flat[i + 4]! });
  pages.set(id, { frame, targets });
  const typing = ((flat[0] ?? 0) & 1) !== 0;
  if (typing && typingApp() !== id) setTypingApp(id);
  else if (!typing && typingApp() === id) setTypingApp(null);
  return targets;
}

/** Whether applet `id` is taking typed text (its keyboard is open). */
export const appletTyping = (id: number) => typingApp() === id;

/** The deck keyboard's keys for applet `id`, as a hardware keyboard's. */
const KEY_NAMES: Record<string, string> = { Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };
export const appletKeys = (id: number): KeySink => ({
  text: (text) => host?.appText?.(id, "text", text),
  key: (name) => host?.appText?.(id, "key", KEY_NAMES[name] ?? name),
  close: () => host?.appText?.(id, "key", "Escape"),
  hint: () => "types into the window above · × closes its keyboard",
});

const ERROR = "\u{f015a}";
const isApp = (id: number) => (w: Win) => w.kind === "app" && w.app === id;

/** Opens the package at `path` in a window beside the focused one. An
 *  applet's window shows its touch surface, and the deck brings that surface
 *  up for the fingers. */
export function openPackage(path: string, title: string, aux: boolean, applet = false) {
  const id = host?.openApp?.(path) ?? -1;
  if (id < 0) return toast({ icon: ERROR, title, body: "This host cannot run packages", tone: "error" });
  open({ kind: "app", app: id, path, title, aux, appletSurface: applet });
  if (aux) setBody("controls");
}

/** Ends the package; its window closes now. */
export function closePackage(id: number) {
  host?.closeApp?.(id);
  const w = find(isApp(id));
  if (w) closeWindow(w.id);
  setTextures(({ [id]: _, ...rest }) => rest);
  setSized(({ [id]: _, ...rest }) => rest);
  pages.delete(id);
  if (typingApp() === id) setTypingApp(null);
}

export function showPackage(id: number, visible: boolean) {
  host?.showApp?.(id, visible);
}

/** What the package gets this frame: buttons, and contacts [id, x, y, ...] on its touch surface. */
export function feedPackage(id: number, buttons: number, contacts: number[]) {
  host?.appInput?.(id, buttons, contacts);
}

onEvent((event) => {
  if (event.event === "app") {
    if (event.textures) setTextures((t) => ({ ...t, [event.id]: event.textures! }));
    else {
      const w = find(isApp(event.id));
      toast({ icon: ERROR, title: w?.kind === "app" ? w.title : "Package", body: event.error ?? "did not start", tone: "error" });
      if (w) closeWindow(w.id);
    }
  } else if (event.event === "appExit") {
    const w = find(isApp(event.id));
    toast({ icon: ERROR, title: w?.kind === "app" ? `${w.title} stopped` : "Package stopped", body: event.error, tone: "error" });
    if (w) closeWindow(w.id);
    setTextures(({ [event.id]: _, ...rest }) => rest);
  }
});
