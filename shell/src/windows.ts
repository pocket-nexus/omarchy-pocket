// What a workspace can hold, by name: "terminal" (a new Pocket Term session),
// "agent" (one running Omarchy's default coding agent, `omarchy-agent
// --inline --pick`) or one of the shell's applets. The Apps list opens these, and
// `omarchy-shell pocket.window open <name>` does over SSH;
// `omarchy-shell pocket.window app <path.pocket> [title] [aux]` opens a
// package in a window, as its Apps row does; `slow <factor>` stretches the
// window transitions to watch or film them.
import { applets, appletById, openApplet } from "./applets/applet.ts";
import "./applets/activity.tsx";
import "./applets/clock.tsx";
import "./applets/notes.tsx";
import "./applets/pictures.tsx";
import { request } from "./bridge.ts";
import { openPackage } from "./packages.ts";
import { serve } from "./system.ts";
import { openTerminal } from "./term/store.ts";
import { current, focus, focused, setSlowMotion, WORKSPACES, windowsOn } from "./workspaces.ts";

export function openWindow(name: string): boolean {
  if (name === "terminal") openTerminal();
  else if (name === "agent") openTerminal(["omarchy-agent", "--inline", "--pick"], "Agent");
  else if (appletById(name)) openApplet(name);
  else if (name) openPackageNamed(name);
  else return false;
  return true;
}

/** A package from the daemon's list by its file, its file's stem or its name
 *  (`pocket.window open youtube`); the menu's Apps rows open the same way. */
function openPackageNamed(name: string) {
  const wanted = name.toLowerCase();
  void request<{ id: string; name: string; applet?: string; aux?: boolean; appletSurface?: boolean }[]>({ method: "apps" }).then((apps) => {
    const app = apps.find((a) => {
      const id = a.id.toLowerCase();
      return id === wanted || id === `${wanted}.pocket` || a.name.toLowerCase() === wanted;
    });
    if (app?.applet) openPackage(app.applet, app.name, app.aux === true, app.appletSurface === true);
  });
}

serve("pocket.window", {
  open: (name) => (openWindow(name ?? "") ? "ok" : `no window ${name}`),
  focus: (n) => (focus(Number(n) - 1), "ok"),
  list: () =>
    Array.from({ length: WORKSPACES }, (_, i) => {
      const names = windowsOn(i).map((w) => `${w.kind === "terminal" ? `terminal:${w.sid}` : w.kind === "app" ? `app:${w.app}:${w.title}` : w.applet}${focused()?.id === w.id ? "*" : ""}`);
      return `${i + 1}${i === current() ? ">" : " "} ${names.join(" ") || "-"}`;
    }).join("\n"),
  focused: () => JSON.stringify(focused()),
  applets: () => applets().map((a) => a.id).join(" "),
  /** every transition `factor` times slower, 1 to restore */
  slow: (factor) => (setSlowMotion(Number(factor) || 1), "ok"),
  /** a package in a window: `app <path.pocket> [title] [aux|applet]` */
  app: (path, title, aux) => (openPackage(path ?? "", title || (path ?? "").split("/").pop()!.replace(/\.pocket$/, ""), aux === "aux" || aux === "applet", aux === "applet"), "ok"),
});
