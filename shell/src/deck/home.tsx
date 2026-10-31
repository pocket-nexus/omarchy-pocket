// The deck's home layout: the stage at MAP_SCALE, live, between the
// workspaces and the panels. It shows while nothing has focus, and when the
// Home tab asks for it. A press on a window focuses it, and the deck becomes
// that window's keyboard or pad; a press on a workspace tab switches to it;
// the layout badge toggles dwindle and scrolling; a press in the right column
// opens that panel's card on the stage. Nothing launches from here: the
// menu's Apps list (L1 + A, the strip's logo) opens Terminal, Agent, the
// shell's applets and the touch apps. Moving, swapping, resizing and closing
// windows are the gamepad's chords (chords.ts), not gestures here.
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { perform } from "../actions.ts";
import { flip, TOP_LEFT, type Box } from "../motion.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BAR_H, sameRect, STAGE_H, STAGE_W } from "../wm.ts";
import { act, barPosition, current, focus, focused, layout, occupied, placements, visibleWindows, windowAt, WORKSPACES, type Win } from "../workspaces.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { closePanel, openPanel, showPanel, type PanelName } from "../stage/panels.tsx";
import { state } from "../system.ts";
import { pressAt, pressed } from "./press.ts";

export const MAP_SCALE = 0.7;
const MAP_W = STAGE_W * MAP_SCALE;
const MAP_H = STAGE_H * MAP_SCALE;
const MAP_X = (512 - MAP_W) / 2;
const MAP_Y = 28;

/** the side columns: the workspaces and the layout on the left, the panels on the right */
const SIDE_W = 60;
const LEFT_X = (MAP_X - SIDE_W) / 2;
const RIGHT_X = 512 - MAP_X + (MAP_X - SIDE_W) / 2;
const CELL_H = 40;
const CELL_GAP = 6;
const LAYOUT_Y = MAP_Y + WORKSPACES * (CELL_H + CELL_GAP);
const PANEL_LIST: PanelName[] = ["proxy", "bluetooth", "network", "audio", "power"];
const cellAt = (y: number) => {
  const i = Math.floor((y - MAP_Y) / (CELL_H + CELL_GAP));
  return y >= MAP_Y && y - MAP_Y - i * (CELL_H + CELL_GAP) < CELL_H ? i : -1;
};
/** the workspace tab under body point (x, y), or -1 */
const wsTabAt = (x: number, y: number) => {
  const i = x >= LEFT_X && x < LEFT_X + SIDE_W ? cellAt(y) : -1;
  return i < WORKSPACES ? i : -1;
};
const onBadge = (x: number, y: number) => x >= LEFT_X && x < LEFT_X + SIDE_W && y >= LAYOUT_Y && y < LAYOUT_Y + CELL_H;
const panels = () => PANEL_LIST.filter((p) => p !== "proxy" || state()?.proxy);
/** the panel under body point (x, y) */
const panelAt = (x: number, y: number): PanelName | undefined => (x >= RIGHT_X && x < RIGHT_X + SIDE_W ? panels()[cellAt(y)] : undefined);
const panelGlyph = (p: PanelName) => {
  const s = state();
  return p === "proxy" ? "\u{f0582}" : p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
};

const toStage = (x: number, y: number) => ({ x: (x - MAP_X) / MAP_SCALE, y: (y - MAP_Y) / MAP_SCALE });
const onMap = (x: number, y: number) => x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H;
/** a stage rect on the map, in body coordinates */
const onDeck = (r: Box): Box => ({ x: MAP_X + r.x * MAP_SCALE, y: MAP_Y + r.y * MAP_SCALE, w: r.w * MAP_SCALE, h: r.h * MAP_SCALE });

const icon = (w: Win) => (w.kind === "terminal" ? "\u{f018d}" : w.kind === "app" ? "\u{f0b8a}" : (appletOf(w)?.icon ?? ""));
const title = (w: Win) => (w.kind === "terminal" ? "Terminal" : w.kind === "app" ? w.title : (appletOf(w)?.title ?? w.applet));

/** The pressed look's target under a finger. */
export function homeTarget(x: number, y: number): string | null {
  const ws = wsTabAt(x, y);
  if (ws >= 0) return `home:ws${ws}`;
  if (onBadge(x, y)) return "home:layout";
  const p = panelAt(x, y);
  if (p) return `home:${p}`;
  if (onMap(x, y)) {
    const at = toStage(x, y);
    const id = windowAt(at.x, at.y);
    if (id !== null) return `home:win${id}`;
  }
  return null;
}

function tap(x: number, y: number) {
  const ws = wsTabAt(x, y);
  if (ws >= 0) return focus(ws);
  if (onBadge(x, y)) return perform("layout");
  const p = panelAt(x, y);
  if (p) return openPanel() === p ? closePanel() : showPanel(p);
  if (onMap(x, y)) {
    const at = toStage(x, y);
    const id = windowAt(at.x, at.y);
    if (id !== null) act((m) => m.focusWin(id));
  }
}

/** The home layout's fingers this frame (body coordinates): a finger acts where it settles. */
export function homeTouch(frame: TouchFrame) {
  const c = frame.down[0];
  pressAt(c && !c.moved ? homeTarget(c.x, c.y) : null);
  for (const p of frame.presses) tap(p.x, p.y);
}

/** One window on the map, kept while the window lives: a layout change
 *  moves it on the core's tracks from where it was drawn. */
function Tile(props: { win: Win }) {
  const rect = createMemo(() => onDeck(placements().find((p) => p.id === props.win.id)?.rect ?? { x: 0, y: 0, w: 0, h: 0 }), undefined, { equals: sameRect });
  const hidden = () => placements().find((p) => p.id === props.win.id)?.hidden ?? true;
  const isFocused = () => focused()?.id === props.win.id;
  const lit = () => pressed(`home:win${props.win.id}`);
  let node: NodeMirror | undefined;
  createEffect(
    on(rect, (next, prev) => {
      if (!node) return;
      if (prev) flip(node, prev, next);
      else flip(node, { x: next.x + next.w * 0.065, y: next.y + next.h * 0.065, w: next.w * 0.87, h: next.h * 0.87 }, next, 0, 1);
    }),
  );
  onCleanup(() => (node = undefined));
  return (
    <View
      class="absolute overflow-hidden"
      style={{
        insetL: rect().x - MAP_X,
        insetT: rect().y - MAP_Y,
        width: rect().w,
        height: rect().h,
        opacity: hidden() ? 0 : 1,
        bgColor: color(lit() ? "bright_foreground" : isFocused() ? "accent" : "muted"),
        ...TOP_LEFT,
      }}
      ref={(n: NodeMirror) => (node = n)}
    >
      <View class="absolute left-[2] top-[2] overflow-hidden" style={{ width: rect().w - 4, height: rect().h - 4, bgColor: color(isFocused() ? "lighter_background" : "background") }}>
        <Text class="absolute left-0 text-center font-mono text-base leading-[20]" style={{ insetT: rect().h / 2 - 22, width: rect().w - 4, textColor: color(isFocused() ? "accent" : "foreground") }}>
          {icon(props.win)}
        </Text>
        <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: rect().h / 2, width: rect().w - 4, textColor: color(isFocused() ? "bright_foreground" : "dark_foreground") }}>
          {title(props.win)}
        </Text>
      </View>
    </View>
  );
}

export function Home() {
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
            nothing open here · the menu's Apps opens a window
          </Text>
        </Show>
      </View>
      <Text class="absolute left-0 w-[512] text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_Y + MAP_H + 12, textColor: color("dark_foreground") }}>
        press a window for its keys · L1 + B closes · R1 + D-pad swaps
      </Text>
      <For each={Array.from({ length: WORKSPACES }, (_, i) => i)}>
        {(n) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: LEFT_X, insetT: MAP_Y + n * (CELL_H + CELL_GAP), width: SIDE_W, height: CELL_H, bgColor: color(current() === n || pressed(`home:ws${n}`) ? "selection" : "dark_background") }}
          >
            <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: CELL_H / 2 - 8, width: SIDE_W, textColor: color(current() === n ? "accent" : occupied(n) ? "foreground" : "muted") }}>
              {String(n + 1)}
            </Text>
          </View>
        )}
      </For>
      <View class="absolute rounded-md" style={{ insetL: LEFT_X, insetT: LAYOUT_Y, width: SIDE_W, height: CELL_H, bgColor: color(pressed("home:layout") ? "selection" : "background") }}>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: CELL_H / 2 - 7, width: SIDE_W, textColor: color("dark_foreground") }}>
          {layout() === "dwindle" ? "tile" : "scroll"}
        </Text>
      </View>
      <For each={panels()}>
        {(p, i) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: RIGHT_X, insetT: MAP_Y + i() * (CELL_H + CELL_GAP), width: SIDE_W, height: CELL_H, bgColor: color(openPanel() === p || pressed(`home:${p}`) ? "selection" : "dark_background") }}
          >
            <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: CELL_H / 2 - 9, width: SIDE_W, textColor: color(openPanel() === p ? "accent" : p === "proxy" && state()?.proxy?.running === false ? "muted" : "foreground") }}>
              {panelGlyph(p)}
            </Text>
          </View>
        )}
      </For>
    </>
  );
}
