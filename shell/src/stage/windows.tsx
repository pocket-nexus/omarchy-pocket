// The current workspace's windows on the stage. A window is laid out at its
// placement and the motion store (workspaces.ts) animates its transform
// between placements, so its content never reflows during a transition. Each
// frame carries Omarchy's border (the theme's accent on the focused window,
// its muted colour on the rest), a title header, and a terminal grid or an
// applet's view laid out in the space under the header. A fullscreen window
// covers the others, which stay mounted (faded out) so their state is kept.
// A closed window leaves its outline, which shrinks and fades.
import { createMemo, For, onCleanup } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { sessionById } from "../term/store.ts";
import { TermGrid } from "../term/grid.tsx";
import { color } from "../theme.ts";
import { BORDER, sameRect, type Rect } from "../wm.ts";
import { bindGhost, bindWindow, focused, ghosts, placements, visibleWindows, WINDOW_ORIGIN, type Win } from "../workspaces.ts";

export const HEADER_H = 16;
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export const windowTitle = (w: Win) => (w.kind === "terminal" ? sessionById(w.sid)?.title() || "Terminal" : (appletOf(w)?.title ?? w.applet));

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
