// The current workspace's windows on the stage. A window is laid out at its
// placement and the motion store (workspaces.ts) animates its transform
// between placements, so its content never reflows during a transition. Each
// frame carries Omarchy's border (the theme's accent on the focused window,
// its muted colour on the rest), a title header, and a terminal grid or an
// applet's view laid out in the space under the header. A fullscreen window
// covers the others, which stay mounted (faded out) so their state is kept.
// A closed window leaves its outline, which shrinks and fades.
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { after } from "@pocketjs/framework/clock";
import { appletFit, appletRefused, appTextures, fitSurface, sizeApplet } from "../packages.ts";
import { appletOf } from "../applets/applet.ts";
import { sessionById } from "../term/store.ts";
import { TermGrid } from "../term/grid.tsx";
import { color } from "../theme.ts";
import { BORDER, sameRect, type Rect } from "../wm.ts";
import { bindGhost, bindWindow, focused, ghosts, placements, visibleWindows, WINDOW_ORIGIN, type Win } from "../workspaces.ts";

export const HEADER_H = 16;
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export const windowTitle = (w: Win) =>
  w.kind === "terminal" ? sessionById(w.sid)?.title() || "Terminal" : w.kind === "app" ? w.title : (appletOf(w)?.title ?? w.applet);

/** A package in its window. An applet shows its touch surface, sized to the
 *  tile (packages.ts fitSurface) once the tile has settled for SETTLE_S, and
 *  drawn at the size it last had until the host has the new one; a tile too
 *  small for it shows a card instead and the applet pauses. Any other package
 *  shows its top display letterboxed at 4:3. The texture is a GL framebuffer,
 *  first row at the bottom, so the image flips on Y. */
const SETTLE_S = 0.3;
function AppView(props: { app: number; title: string; applet: boolean; w: number; h: number }) {
  let node: NodeMirror | undefined;
  const texture = () => appTextures(props.app)?.[props.applet ? 1 : 0];
  createEffect(() => {
    const t = texture();
    if (node && t !== undefined) getOps().setImage(node.id, t);
  });
  const fit = createMemo(() => (props.applet ? fitSurface(props.w, props.h) : null), undefined, {
    equals: (a, b) => a === b || (!!a && !!b && a.w === b.w && a.h === b.h && a.scale === b.scale),
  });
  if (props.applet) {
    let generation = 0;
    createEffect(() => {
      const next = fit();
      const mine = ++generation;
      // the first size goes at once (the applet mounts on it); later ones once the tile settles
      if (appletFit(props.app) === undefined) return sizeApplet(props.app, next);
      after(SETTLE_S, () => mine === generation && sizeApplet(props.app, next));
    });
  }
  /** the surface as it is now, drawn to fit the tile */
  const surface = () => (props.applet ? appletFit(props.app) : null) ?? (props.applet ? null : { w: 512, h: 384, scale: 1 });
  const drawn = () => {
    const s = surface();
    if (!s) return { x: 0, y: 0, w: 0, h: 0 };
    const k = Math.min(props.w / s.w, props.h / s.h, props.applet ? 1 : Infinity);
    return { x: (props.w - s.w * k) / 2, y: (props.h - s.h * k) / 2, w: s.w * k, h: s.h * k };
  };
  return (
    <>
      <Image
        ref={(n: NodeMirror) => (node = n)}
        class="absolute"
        src="wall-0-0.png"
        style={{ insetL: drawn().x, insetT: drawn().y, width: drawn().w, height: drawn().h, scaleY: -1, opacity: texture() === undefined || !surface() ? 0 : 1 }}
      />
      <Show when={props.applet && appletRefused(props.app)}>
        <Text class="absolute left-0 text-center text-xl leading-[24]" style={{ insetT: props.h / 2 - 30, width: props.w, textColor: color("dark_foreground") }}>{"\u{f0b8a}"}</Text>
        <Text class="absolute left-0 h-[16] overflow-hidden text-center font-mono text-xs leading-[16]" style={{ insetT: props.h / 2, width: props.w, textColor: color("foreground") }}>
          {props.title}
        </Text>
        <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: props.h / 2 + 18, width: props.w, textColor: color("dark_foreground") }}>
          {"needs a bigger tile"}
        </Text>
      </Show>
      <Show when={texture() === undefined && !(props.applet && appletRefused(props.app))}>
        <Text class="absolute left-0 h-[16] overflow-hidden text-center font-mono text-sm leading-[16]" style={{ insetT: props.h / 2 - 8, width: props.w, textColor: color("dark_foreground") }}>
          {`starting ${props.title}`}
        </Text>
      </Show>
    </>
  );
}

function Frame(props: { win: Win }) {
  const rect = createMemo(() => placements().find((p) => p.id === props.win.id)?.rect ?? NO_RECT, NO_RECT, { equals: sameRect });
  const isFocused = createMemo(() => focused()?.id === props.win.id);
  const contentW = createMemo(() => Math.max(0, rect().w - 2 * BORDER));
  const contentH = createMemo(() => Math.max(0, rect().h - 2 * BORDER - HEADER_H));
  const applet = appletOf(props.win);
  return (
    <View
      class="absolute overflow-hidden contain-strict"
      style={{ insetL: rect().x, insetT: rect().y, width: rect().w, height: rect().h, bgColor: color(isFocused() ? "accent" : "muted"), ...WINDOW_ORIGIN }}
      ref={(node: NodeMirror) => onCleanup(bindWindow(props.win.id, node))}
    >
      <View class="absolute overflow-hidden" style={{ insetL: BORDER, insetT: BORDER, width: contentW(), height: rect().h - 2 * BORDER, bgColor: color("background") }}>
        <View class="absolute left-0 top-0" style={{ width: contentW(), height: HEADER_H, bgColor: color(isFocused() ? "lighter_background" : "dark_background") }}>
          <Text
            class="absolute left-[6] top-[1] h-[14] overflow-hidden font-mono text-xs leading-[14]"
            style={{ width: contentW() - 12, textColor: color(isFocused() ? "bright_foreground" : "dark_foreground") }}
          >
            {windowTitle(props.win)}
          </Text>
        </View>
        <View class="absolute left-0 overflow-hidden contain-strict" style={{ insetT: HEADER_H, width: contentW(), height: contentH() }}>
          {props.win.kind === "terminal" ? (
            <TermGrid sid={props.win.sid} w={contentW()} h={contentH()} />
          ) : props.win.kind === "app" ? (
            <AppView app={props.win.app} title={props.win.title} applet={props.win.appletSurface} w={contentW()} h={contentH()} />
          ) : applet ? (
            <applet.Stage w={contentW()} h={contentH()} focused={isFocused()} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function Windows() {
  return (
    <>
      <For each={visibleWindows()}>{(win) => <Frame win={win} />}</For>
      <For each={ghosts()}>
        {(ghost) => (
          <View
            class="absolute"
            style={{ insetL: ghost.rect.x, insetT: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h, bgColor: color("muted", 0.9) }}
            ref={(node: NodeMirror) => bindGhost(node)}
          >
            <View class="absolute" style={{ insetL: BORDER, insetT: BORDER, width: ghost.rect.w - 2 * BORDER, height: ghost.rect.h - 2 * BORDER, bgColor: color("background", 0.9) }} />
          </View>
        )}
      </For>
    </>
  );
}
