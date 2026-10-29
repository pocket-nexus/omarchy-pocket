// The current workspace's windows on the stage, tiled by wm.ts: each one a
// frame with Omarchy's border (the theme's accent on the focused window, its
// muted colour on the rest) around a terminal grid or an applet's stage view
// laid out in the frame's size. A fullscreen window covers the others, which
// stay mounted so their state is kept.
import { createMemo, For, Show } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { TermGrid } from "../term/grid.tsx";
import { color } from "../theme.ts";
import { BORDER } from "../wm.ts";
import { focused, placements, visibleWindows, type Win } from "../workspaces.ts";

function Frame(props: { win: Win }) {
  const placement = createMemo(() => placements().find((p) => p.id === props.win.id));
  const isFocused = () => focused()?.id === props.win.id;
  const inner = () => {
    const r = placement()?.rect;
    return r ? { w: r.w - 2 * BORDER, h: r.h - 2 * BORDER } : { w: 0, h: 0 };
  };
  const applet = appletOf(props.win);
  return (
    <Show when={placement()}>
      {(p) => (
        <View
          class="absolute overflow-hidden"
          style={{
            insetL: p().rect.x,
            insetT: p().rect.y,
            width: p().rect.w,
            height: p().rect.h,
            opacity: p().hidden ? 0 : 1,
            bgColor: color(isFocused() ? "accent" : "muted"),
          }}
        >
          <View class="absolute overflow-hidden" style={{ insetL: BORDER, insetT: BORDER, width: inner().w, height: inner().h, bgColor: color("background") }}>
            {props.win.kind === "terminal" ? (
              <TermGrid sid={props.win.sid} w={inner().w} h={inner().h} />
            ) : applet ? (
              <applet.Stage w={inner().w} h={inner().h} focused={isFocused()} />
            ) : null}
          </View>
        </View>
      )}
    </Show>
  );
}

export function Windows() {
  return <For each={visibleWindows()}>{(win) => <Frame win={win} />}</For>;
}
