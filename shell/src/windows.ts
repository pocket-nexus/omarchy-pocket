// What a workspace can hold, by name: "terminal" (a new Pocket Term session)
// or one of the shell's applets. The Apps list opens these, and
// `omarchy-shell pocket.window open <name>` does over SSH;
// `omarchy-shell pocket.window launch <path.pocket>` runs a package applet in
// place of the shell, as its Apps row does.
import { applets, appletById, openApplet } from "./applets/applet.ts";
import "./applets/activity.tsx";
import "./applets/clock.tsx";
import "./applets/notes.tsx";
import "./applets/pictures.tsx";
import { serve } from "./system.ts";
import { openTerminal } from "./term/store.ts";
import { current, focus, focused, WORKSPACES, windowsOn } from "./workspaces.ts";

export function openWindow(name: string): boolean {
  if (name === "terminal") openTerminal();
  else if (appletById(name)) openApplet(name);
  else return false;
  return true;
}

serve("pocket.window", {
  open: (name) => (openWindow(name ?? "") ? "ok" : `no window ${name}`),
  focus: (n) => (focus(Number(n) - 1), "ok"),
  list: () =>
    Array.from({ length: WORKSPACES }, (_, i) => {
      const names = windowsOn(i).map((w) => `${w.kind === "terminal" ? `terminal:${w.sid}` : w.applet}${focused()?.id === w.id ? "*" : ""}`);
      return `${i + 1}${i === current() ? ">" : " "} ${names.join(" ") || "-"}`;
    }).join("\n"),
  focused: () => JSON.stringify(focused()),
  applets: () => applets().map((a) => a.id).join(" "),
  launch: (path) => {
    const bridge = (globalThis as { omarchyBridge?: { launch(path: string): boolean } }).omarchyBridge;
    return bridge?.launch(path ?? "") ? "ok" : `cannot launch ${path}`;
  },
});
