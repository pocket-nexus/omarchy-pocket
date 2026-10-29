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
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { closeFocused, toggleControls } from "../actions.ts";
import { flip, place, TOP_LEFT, type Box } from "../motion.ts";
import { color } from "../theme.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { BAR_H, sameRect, STAGE_H, STAGE_W, type SplitHandle } from "../wm.ts";
import { act, barPosition, focused, placements, splitAt, visibleWindows, windowAt, windowById, type Win } from "../workspaces.ts";
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
/** a stage rect on the map, in body coordinates */
const onDeck = (r: Box): Box => ({ x: MAP_X + r.x * MAP_SCALE, y: MAP_Y + r.y * MAP_SCALE, w: r.w * MAP_SCALE, h: r.h * MAP_SCALE });

const icon = (w: Win) => (w.kind === "terminal" ? "\u{f018d}" : (appletOf(w)?.icon ?? ""));
const title = (w: Win) => (w.kind === "terminal" ? "Terminal" : (appletOf(w)?.title ?? w.applet));

type Gesture =
  | { kind: "window"; id: number }
  | { kind: "split"; handle: SplitHandle }
  | { kind: "pan" }
  | { kind: "none" };

/** What the finger holding the map is doing: its id and the gesture. */
let finger: { id: number; gesture: Gesture } | null = null;
interface Drag {
  id: number;
  /** the tile's box where the finger picked it up, and the finger's travel */
  from: Box;
  dx: number;
  dy: number;
  over: number | null;
  overWs: number;
}
const [drag, setDrag] = createSignal<Drag | null>(null);
const [closing, setClosing] = createSignal<{ id: number; over: boolean } | null>(null);
/** the strip reads the tab a window is dragged over */
export const dropWorkspace = () => drag()?.overWs ?? -1;

/** the floating copy of a dragged tile, moved by the finger */
let proxy: NodeMirror | undefined;
/** where a tile is drawn after a drop, for its next move to start from */
const landing = new Map<number, Box>();
const tileNodes = new Map<number, NodeMirror>();

function begin(c: Contact): Gesture {
  if (!onMap(c.start.x, c.start.y)) return { kind: "none" };
  const p = toStage(c.start.x, c.start.y);
  const handle = splitAt(p.x, p.y, SPLIT_TOLERANCE);
  if (handle) return { kind: "split", handle };
  const id = windowAt(p.x, p.y);
  if (id !== null) return { kind: "window", id };
  return { kind: "pan" };
}

/** Puts a dragged tile down: the swap or move happens, or nothing does, and
 *  the tile flies from where the copy was to where it now belongs. */
function drop(d: Drag) {
  const at: Box = { ...d.from, x: d.from.x + d.dx, y: d.from.y + d.dy };
  landing.set(d.id, at);
  if (d.overWs >= 0) act((m) => m.moveToWs(d.id, d.overWs));
  else if (d.over !== null) {
    act((m) => m.swap(d.id, d.over!));
  } else {
    // back home
    const node = tileNodes.get(d.id);
    if (node) flip(node, at, d.from);
    landing.delete(d.id);
  }
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
        const hit = onMap(c.x, c.y) ? windowAt(p.x, p.y) : null;
        const over = hit === g.id ? null : hit;
        const overWs = c.y < 0 ? tabAt(c.x) : -1;
        const was = drag();
        const from = was?.from ?? onDeck(placements().find((q) => q.id === g.id)!.rect);
        const dx = c.x - c.start.x;
        const dy = c.y - c.start.y;
        if (!was || was.over !== over || was.overWs !== overWs) setDrag({ id: g.id, from, dx, dy, over, overWs });
        else {
          was.dx = dx;
          was.dy = dy;
        }
        place(proxy, "translateX", dx);
        place(proxy, "translateY", dy);
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
    setDrag(null);
    if (g.kind !== "window") continue;
    if (held) {
      if (held.over) {
        act((m) => m.focusWin(held.id));
        closeFocused();
      }
    } else if (d) drop(d);
    else if (tap.moved) continue;
    else if (focused()?.id === g.id) toggleControls();
    else act((m) => m.focusWin(g.id));
  }
  if (!frame.down.length && !frame.taps.length) finger = null;
}

/** One window on the map, kept while the window lives: a layout change
 *  moves it on the core's tracks from where it was drawn. */
function Tile(props: { win: Win }) {
  const rect = createMemo(() => onDeck(placements().find((p) => p.id === props.win.id)?.rect ?? { x: 0, y: 0, w: 0, h: 0 }), undefined, { equals: sameRect });
  const hidden = () => placements().find((p) => p.id === props.win.id)?.hidden ?? true;
  const isFocused = () => focused()?.id === props.win.id;
  const target = () => drag()?.over === props.win.id;
  const lifted = () => drag()?.id === props.win.id || closing()?.id === props.win.id;
  let node: NodeMirror | undefined;
  createEffect(
    on(rect, (next, prev) => {
      if (!node) return;
      const from = landing.get(props.win.id) ?? prev;
      landing.delete(props.win.id);
      if (from) flip(node, from, next);
      else flip(node, { x: next.x + next.w * 0.065, y: next.y + next.h * 0.065, w: next.w * 0.87, h: next.h * 0.87 }, next, 0, 1);
    }),
  );
  onCleanup(() => {
    if (tileNodes.get(props.win.id) === node) tileNodes.delete(props.win.id);
  });
  return (
    <View
      class="absolute overflow-hidden"
      style={{
        insetL: rect().x - MAP_X,
        insetT: rect().y - MAP_Y,
        width: rect().w,
        height: rect().h,
        opacity: hidden() ? 0 : lifted() ? 0.35 : 1,
        bgColor: color(target() ? "bright_foreground" : isFocused() ? "accent" : "muted"),
        ...TOP_LEFT,
      }}
      ref={(n: NodeMirror) => {
        node = n;
        tileNodes.set(props.win.id, n);
      }}
    >
      <TileFace win={props.win} w={rect().w} h={rect().h} focused={isFocused()} />
    </View>
  );
}

function TileFace(props: { win: Win; w: number; h: number; focused: boolean }) {
  return (
    <View class="absolute left-[2] top-[2] overflow-hidden" style={{ width: props.w - 4, height: props.h - 4, bgColor: color(props.focused ? "lighter_background" : "background") }}>
      <Text class="absolute left-0 text-center font-mono text-base leading-[20]" style={{ insetT: props.h / 2 - 22, width: props.w - 4, textColor: color(props.focused ? "accent" : "foreground") }}>
        {icon(props.win)}
      </Text>
      <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: props.h / 2, width: props.w - 4, textColor: color(props.focused ? "bright_foreground" : "dark_foreground") }}>
        {title(props.win)}
      </Text>
    </View>
  );
}

export function Minimap() {
  const bar = () => barPosition();
  return (
    <>
      <View class="absolute overflow-hidden rounded-sm" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H, bgColor: color("dark_background") }}>
        <Show when={bar() !== "none"}>
          <View class="absolute left-0" style={{ insetT: bar() === "bottom" ? MAP_H - BAR_H * MAP_SCALE : 0, width: MAP_W, height: BAR_H * MAP_SCALE, bgColor: color("background") }} />
        </Show>
        <For each={visibleWindows()}>{(win) => <Tile win={win} />}</For>
        <Show when={visibleWindows().length === 0}>
          <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_H / 2 - 7, width: MAP_W, textColor: color("dark_foreground") }}>
            an empty workspace: the dock opens a window
          </Text>
        </Show>
      </View>
      <Text class="absolute left-0 w-[512] text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_Y + MAP_H + 12, textColor: color("dark_foreground") }}>
        tap focus · again controls · hold close · drag swap or move
      </Text>
      <Show when={drag()?.id ?? null} keyed>
        {(id) => {
          const d = drag()!;
          const win = windowById(id);
          return win ? (
            <View
              class="absolute overflow-hidden rounded-sm"
              style={{ insetL: d.from.x, insetT: d.from.y, width: d.from.w, height: d.from.h, bgColor: color("accent"), opacity: 0.92 }}
              ref={(n: NodeMirror) => {
                proxy = n;
                jump(n, "translateX", d.dx);
                jump(n, "translateY", d.dy);
                jump(n, "scaleX", 1.04);
                jump(n, "scaleY", 1.04);
              }}
            >
              <TileFace win={win} w={d.from.w} h={d.from.h} focused={true} />
            </View>
          ) : null;
        }}
      </Show>
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
