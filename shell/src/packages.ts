// PocketJS packages in the shell's windows. A package never runs in place of
// the shell: the host program runs it beside the shell in a Runtime of its
// own (host/src/children.rs), drawing its two displays into textures, and
// the shell's window shows the top one (an applet's: its touch surface, its
// UI); the deck's controls body shows its touch surface, or a touch gamepad
// when it has none. The window manager
// keeps the shoulders, L2/R2 and SELECT; the focused package gets the other
// buttons. A package off the current workspace is paused.
import { createSignal } from "solid-js";
import { onEvent } from "./bridge.ts";
import { toast } from "./stage/toasts.tsx";
import { closeWindow, find, open, type Win } from "./workspaces.ts";
import { setBody } from "./deck/body.ts";

interface AppBridge {
  openApp(path: string): number;
  closeApp(id: number): void;
  showApp(id: number, visible: boolean): void;
  appInput(id: number, buttons: number, contacts: number[]): void;
}
const host = (globalThis as { omarchyBridge?: Partial<AppBridge> }).omarchyBridge;

/** each package window's textures, top display then touch surface, once booted */
const [textures, setTextures] = createSignal<Record<number, number[]>>({});
export const appTextures = (id: number) => textures()[id] ?? null;

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
