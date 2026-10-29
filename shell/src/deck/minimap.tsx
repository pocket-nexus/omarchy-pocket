// The deck's body by default: the stage at MAP_SCALE, live. It is the stage,
// not a picture of it, as in Pocket Shell's 3DS deck:
//
//   tap a window            focus it; tap the focused one for its controls
//   hold a window           the close bar rises; release on it to close the
//                           window (one contact and a small × are how shells
//                           get killed, so closing is a hold, a slide and a
//                           release)
//   drag a window           onto another to swap the two, onto a workspace
//                           tab in the strip to move it there
//   drag a gap              moves that split (dwindle)
//   drag the background     pans the strip (scrolling)
import { createSignal, For, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { closeFocused, toggleControls } from "../actions.ts";
import { color } from "../theme.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { BAR_H, STAGE_H, STAGE_W, type SplitHandle } from "../wm.ts";
import { act, barPosition, focused, placements, splitAt, windowAt, windowById, type Win } from "../workspaces.ts";
import { BODY_H } from "./geometry.ts";
import { tabAt } from "./strip.tsx";

export const MAP_SCALE = 0.7;
const MAP_W = STAGE_W * MAP_SCALE;
const MAP_H = STAGE_H * MAP_SCALE;
const MAP_X = (512 - MAP_W) / 2;
const MAP_Y = 6;
const CLOSE_H = 40;
const CLOSE_Y = BODY_H - CLOSE_H;
/** frames a still finger takes to arm the close bar (0.4 s) */
const HOLD_FRAMES = 24;
const SPLIT_TOLERANCE = 8;

const toStage = (x: number, y: number) => ({ x: (x - MAP_X) / MAP_SCALE, y: (y - MAP_Y) / MAP_SCALE });
const onMap = (x: number, y: number) => x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H;

const icon = (w: Win) => (w.kind === "terminal" ? "\u{f018d}" : (appletOf(w)?.icon ?? ""));
const title = (w: Win) => (w.kind === "terminal" ? "Terminal" : (appletOf(w)?.title ?? w.applet));

type Gesture =
  | { kind: "window"; id: number }
  | { kind: "split"; handle: SplitHandle }
  | { kind: "pan" }
  | { kind: "none" };

/** What the finger holding the map is doing: its id and the gesture. */
let finger: { id: number; gesture: Gesture } | null = null;
const [drag, setDrag] = createSignal<{ id: number; over: number | null; overWs: number }>({ id: -1, over: null, overWs: -1 });
const [closing, setClosing] = createSignal<{ id: number; over: boolean } | null>(null);
/** the strip reads the tab a window is dragged over */
export const dropWorkspace = () => drag().overWs;

function begin(c: Contact): Gesture {
  if (!onMap(c.start.x, c.start.y)) return { kind: "none" };
  const p = toStage(c.start.x, c.start.y);
  const handle = splitAt(p.x, p.y, SPLIT_TOLERANCE);
  if (handle) return { kind: "split", handle };
  const id = windowAt(p.x, p.y);
  if (id !== null) return { kind: "window", id };
  return { kind: "pan" };
}

/** The body's fingers this frame, in body coordinates (the strip is above y = 0). */
export function minimapTouch(frame: TouchFrame) {
  const c = frame.down[0];
  if (c && (!finger || finger.id !== c.id)) finger = { id: c.id, gesture: begin(c) };
  if (c && finger) {
    const g = finger.gesture;
    if (g.kind === "window") {
      const held = closing();
      if (!held && !c.moved && c.frames >= HOLD_FRAMES) setClosing({ id: g.id, over: false });
      else if (held) setClosing({ id: held.id, over: c.y >= CLOSE_Y });
      else if (c.moved) {
        const p = toStage(c.x, c.y);
        const over = onMap(c.x, c.y) ? windowAt(p.x, p.y) : null;
        setDrag({ id: g.id, over: over === g.id ? null : over, overWs: c.y < 0 ? tabAt(c.x) : -1 });
      }
    } else if (g.kind === "split" && c.moved) {
      const p = toStage(c.x, c.y);
      act((m) => m.dragSplit(g.handle, p.x, p.y));
    } else if (g.kind === "pan" && c.dx) {
      act((m) => m.panBy(-c.dx / MAP_SCALE));
    }
  }
  for (const tap of frame.taps) {
    if (!finger || finger.id !== tap.id) continue;
    const g = finger.gesture;
    finger = null;
    const held = closing();
    const d = drag();
    setClosing(null);
    setDrag({ id: -1, over: null, overWs: -1 });
    if (g.kind !== "window") continue;
    if (held) {
      if (held.over) {
        act((m) => m.focusWin(held.id));
        closeFocused();
      }
    } else if (tap.moved) {
      if (d.overWs >= 0) act((m) => m.moveToWs(g.id, d.overWs));
      else if (d.over !== null) act((m) => m.swap(g.id, d.over!));
    } else if (focused()?.id === g.id) toggleControls();
    else act((m) => m.focusWin(g.id));
  }
  if (!frame.down.length && !frame.taps.length) finger = null;
}

export function Minimap() {
  const frames = () =>
    placements()
      .filter((p) => !p.hidden)
      .map((p) => ({ p, win: windowById(p.id)! }));
  const bar = () => barPosition();
  return (
    <>
      <View class="absolute overflow-hidden rounded-sm" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H, bgColor: color("dark_background") }}>
        <Show when={bar() !== "none"}>
          <View class="absolute left-0" style={{ insetT: bar() === "bottom" ? MAP_H - BAR_H * MAP_SCALE : 0, width: MAP_W, height: BAR_H * MAP_SCALE, bgColor: color("background") }} />
        </Show>
        <For each={frames()}>
          {(f) => {
            const r = () => f.p.rect;
            const isFocused = () => focused()?.id === f.p.id;
            const target = () => drag().over === f.p.id;
            const dragged = () => drag().id === f.p.id || closing()?.id === f.p.id;
            return (
              <View
                class="absolute overflow-hidden"
                style={{
                  insetL: r().x * MAP_SCALE,
                  insetT: r().y * MAP_SCALE,
                  width: r().w * MAP_SCALE,
                  height: r().h * MAP_SCALE,
                  opacity: dragged() ? 0.55 : 1,
                  bgColor: color(target() ? "bright_foreground" : isFocused() ? "accent" : "muted"),
                }}
              >
                <View class="absolute left-[2] top-[2] overflow-hidden" style={{ width: r().w * MAP_SCALE - 4, height: r().h * MAP_SCALE - 4, bgColor: color(isFocused() ? "lighter_background" : "background") }}>
                  <Text class="absolute left-0 text-center font-mono text-base leading-[20]" style={{ insetT: (r().h * MAP_SCALE) / 2 - 22, width: r().w * MAP_SCALE - 4, textColor: color(isFocused() ? "accent" : "foreground") }}>
                    {icon(f.win)}
                  </Text>
                  <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: (r().h * MAP_SCALE) / 2, width: r().w * MAP_SCALE - 4, textColor: color(isFocused() ? "bright_foreground" : "dark_foreground") }}>
                    {title(f.win)}
                  </Text>
                </View>
              </View>
            );
          }}
        </For>
        <Show when={frames().length === 0}>
          <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_H / 2 - 7, width: MAP_W, textColor: color("dark_foreground") }}>
            an empty workspace: the dock opens a window
          </Text>
        </Show>
      </View>
      <Text class="absolute left-0 w-[512] text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_Y + MAP_H + 12, textColor: color("dark_foreground") }}>
        tap focus · again controls · hold close · drag swap or move
      </Text>
      <Show when={closing()}>
        {(held) => (
          <View
            class="absolute left-[8] w-[496] rounded-md"
            style={{ insetT: CLOSE_Y, height: CLOSE_H - 4, bgColor: color(held().over ? "red" : "dark_background") }}
            ref={(node: NodeMirror) => {
              jump(node, "translateY", CLOSE_H);
              jump(node, "opacity", 0);
              animate(node, "translateY", 0, { dur: 100, easing: "out" });
              animate(node, "opacity", 1, { dur: 100, easing: "out" });
            }}
          >
            <Text class="absolute left-0 top-[10] w-[496] text-center font-mono text-sm leading-[16]" style={{ textColor: color(held().over ? "background" : "red") }}>
              {`\u{f0156}  release here to close ${title(windowById(held().id) ?? ({ kind: "terminal", sid: 0, id: 0, ws: 0 } as Win))}`}
            </Text>
          </View>
        )}
      </Show>
    </>
  );
}
