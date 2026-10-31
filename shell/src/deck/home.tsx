// The deck's home layout: the stage at MAP_SCALE, live, with the workspaces
// beside it, and a list of what there is to open. It shows while nothing has
// focus, and when the Home tab asks for it. A press on a window focuses it,
// and the deck becomes that window's keyboard or pad; a press on a workspace
// tab switches to it; the layout badge toggles dwindle and scrolling. The
// list's rows are the windows the shell opens (a press opens one beside the
// focused window, or focuses it where it is; Terminal always opens a new
// session; Agent opens one running Omarchy's default coding agent,
// `omarchy-agent --inline --pick`), the touch apps (one window each), and the
// bar's panels (a press opens the panel's card on the stage). Moving,
// swapping, resizing and closing windows are the gamepad's chords
// (chords.ts), not gestures here.
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf, openApplet } from "../applets/applet.ts";
import { perform } from "../actions.ts";
import { flip, TOP_LEFT, type Box } from "../motion.ts";
import { openPackage } from "../packages.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BAR_H, sameRect, STAGE_H, STAGE_W } from "../wm.ts";
import { act, barPosition, current, find, focus, focused, focusWindow, layout, occupied, placements, revision, visibleWindows, windowAt, WORKSPACES, type Win } from "../workspaces.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { closePanel, openPanel, showPanel, type PanelName } from "../stage/panels.tsx";
import { state } from "../system.ts";
import { openTerminal } from "../term/store.ts";
import { pressAt, pressed } from "./press.ts";
import { BODY_H } from "./geometry.ts";

export const MAP_SCALE = 0.5;
const MAP_W = STAGE_W * MAP_SCALE;
const MAP_H = STAGE_H * MAP_SCALE;
const MAP_Y = 10;

/** the workspaces and the layout badge, left of the map */
const SIDE_W = 44;
const SIDE_X = 8;
const MAP_X = SIDE_X + SIDE_W + 8;
const CELL_H = 30;
const CELL_GAP = 6;
const LAYOUT_Y = MAP_Y + WORKSPACES * (CELL_H + CELL_GAP);

/** the list, right of the map */
const LIST_X = MAP_X + MAP_W + 12;
const LIST_W = 512 - LIST_X - 8;
const ROW_H = 22;
const LIST_Y = MAP_Y;

interface Row {
  id: string;
  glyph: string;
  label: string;
  /** a gap above this row */
  group?: boolean;
  open(): void;
  /** a window of this: whether it has one, and whether that one has focus */
  state?: () => "focused" | "open" | null;
}

const stateOf = (isIt: (w: Win) => boolean) => (): "focused" | "open" | null => {
  revision();
  const f = focused();
  if (f && isIt(f)) return "focused";
  return find(isIt) ? "open" : null;
};
const app = (id: string, glyph: string, label: string): Row => ({ id, glyph, label, open: () => openApplet(id), state: stateOf((w) => w.kind === "applet" && w.applet === id) });
const APPLETS = "/usr/share/omarchy-pocket/applets";
/** A Pocket applet: its window is focused when it has one, else it opens. */
const applet = (name: string, glyph: string, label: string): Row => {
  const path = `${APPLETS}/${name}.pocket`;
  const isIt = (w: Win) => w.kind === "app" && w.path === path;
  return {
    id: name,
    glyph,
    label,
    open: () => {
      const open = find(isIt);
      if (open) focusWindow(open.id);
      else openPackage(path, label, true, true);
    },
    state: stateOf(isIt),
  };
};
const PANELS: { id: PanelName; label: string }[] = [
  { id: "network", label: "Network" },
  { id: "audio", label: "Audio" },
  { id: "power", label: "Power" },
  { id: "bluetooth", label: "Bluetooth" },
  { id: "proxy", label: "Proxy" },
];
const panelGlyph = (p: PanelName) => {
  const s = state();
  return p === "proxy" ? "\u{f0582}" : p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
};

const ROWS: Row[] = [
  { id: "terminal", glyph: "\u{f018d}", label: "Terminal", open: () => openTerminal(), state: stateOf((w) => w.kind === "terminal") },
  { id: "agent", glyph: "\u{f06a9}", label: "Agent", open: () => openTerminal(["omarchy-agent", "--inline", "--pick"], "Agent") },
  app("notes", "\u{f09ed}", "Notes"),
  app("activity", "\u{f04c5}", "Activity"),
  app("pictures", "\u{f02e9}", "Pictures"),
  app("clock", "\u{f0954}", "Clock"),
  { ...applet("x", "\u{f0544}", "X"), group: true },
  applet("discord", "\u{f066f}", "Discord"),
  applet("youtube", "\u{f05c3}", "YouTube"),
  applet("hn", "\u{f2e5}", "Hacker News"),
];
const rows = (): Row[] => [
  ...ROWS,
  ...PANELS.filter((p) => p.id !== "proxy" || state()?.proxy).map((p, i) => ({
    id: p.id,
    glyph: panelGlyph(p.id),
    label: p.label,
    group: i === 0,
    open: () => (openPanel() === p.id ? closePanel() : showPanel(p.id)),
    state: () => (openPanel() === p.id ? ("focused" as const) : null),
  })),
];
/** each row's top, with a gap before a group */
const rowTops = (list: Row[]) => {
  let y = LIST_Y;
  return list.map((r) => {
    if (r.group) y += 8;
    const top = y;
    y += ROW_H;
    return top;
  });
};
const rowAt = (x: number, y: number): Row | null => {
  if (x < LIST_X || x >= LIST_X + LIST_W) return null;
  const list = rows();
  const tops = rowTops(list);
  const i = tops.findIndex((top) => y >= top && y < top + ROW_H);
  return i >= 0 ? list[i]! : null;
};

const cellAt = (y: number) => {
  const i = Math.floor((y - MAP_Y) / (CELL_H + CELL_GAP));
  return y >= MAP_Y && y - MAP_Y - i * (CELL_H + CELL_GAP) < CELL_H ? i : -1;
};
/** the workspace tab under body point (x, y), or -1 */
const wsTabAt = (x: number, y: number) => {
  const i = x >= SIDE_X && x < SIDE_X + SIDE_W ? cellAt(y) : -1;
  return i < WORKSPACES ? i : -1;
};
const onBadge = (x: number, y: number) => x >= SIDE_X && x < SIDE_X + SIDE_W && y >= LAYOUT_Y && y < LAYOUT_Y + CELL_H;

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
  const row = rowAt(x, y);
  if (row) return `home:${row.id}`;
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
  const row = rowAt(x, y);
  if (row) return row.open();
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
      <View class="absolute left-[1] top-[1] overflow-hidden" style={{ width: rect().w - 2, height: rect().h - 2, bgColor: color(isFocused() ? "lighter_background" : "background") }}>
        <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: rect().h / 2 - 16, width: rect().w - 2, textColor: color(isFocused() ? "accent" : "foreground") }}>
          {icon(props.win)}
        </Text>
        <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: rect().h / 2 + 2, width: rect().w - 2, textColor: color(isFocused() ? "bright_foreground" : "dark_foreground") }}>
          {title(props.win)}
        </Text>
      </View>
    </View>
  );
}

export function Home() {
  const bar = () => barPosition();
  const list = rows;
  const tops = () => rowTops(list());
  return (
    <>
      <For each={Array.from({ length: WORKSPACES }, (_, i) => i)}>
        {(n) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: SIDE_X, insetT: MAP_Y + n * (CELL_H + CELL_GAP), width: SIDE_W, height: CELL_H, bgColor: color(current() === n || pressed(`home:ws${n}`) ? "selection" : "dark_background") }}
          >
            <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: CELL_H / 2 - 8, width: SIDE_W, textColor: color(current() === n ? "accent" : occupied(n) ? "foreground" : "muted") }}>
              {String(n + 1)}
            </Text>
          </View>
        )}
      </For>
      <View class="absolute rounded-md" style={{ insetL: SIDE_X, insetT: LAYOUT_Y, width: SIDE_W, height: CELL_H, bgColor: color(pressed("home:layout") ? "selection" : "background") }}>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: CELL_H / 2 - 7, width: SIDE_W, textColor: color("dark_foreground") }}>
          {layout() === "dwindle" ? "tile" : "scroll"}
        </Text>
      </View>
      <View class="absolute overflow-hidden rounded-sm" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H, bgColor: color("dark_background") }}>
        <Show when={bar() !== "none"}>
          <View class="absolute left-0" style={{ insetT: bar() === "bottom" ? MAP_H - BAR_H * MAP_SCALE : 0, width: MAP_W, height: BAR_H * MAP_SCALE, bgColor: color("background") }} />
        </Show>
        <For each={visibleWindows()}>{(win) => <Tile win={win} />}</For>
        <Show when={visibleWindows().length === 0}>
          <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_H / 2 - 7, width: MAP_W, textColor: color("dark_foreground") }}>
            nothing open here
          </Text>
        </Show>
      </View>
      <Text class="absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetL: MAP_X, insetT: MAP_Y + MAP_H + 10, width: MAP_W, textColor: color("dark_foreground") }}>
        press a window for its keys
      </Text>
      <Text class="absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetL: MAP_X, insetT: MAP_Y + MAP_H + 28, width: MAP_W, textColor: color("dark_foreground") }}>
        L1 + B closes · R1 + D-pad swaps
      </Text>
      <View class="absolute overflow-hidden contain-strict" style={{ insetL: LIST_X, insetT: 0, width: LIST_W, height: BODY_H }}>
        <For each={list()}>
          {(row, i) => (
            <View class="absolute left-0 rounded-sm" style={{ insetT: tops()[i()]!, width: LIST_W, height: ROW_H, bgColor: color(pressed(`home:${row.id}`) ? "selection" : row.state?.() === "focused" ? "dark_background" : "darker_background") }}>
              <Text class="absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14]" style={{ textColor: color(row.state?.() === "focused" ? "accent" : "dark_foreground") }}>{row.glyph}</Text>
              <Text class="absolute left-[32] top-[4] h-[14] overflow-hidden font-mono text-sm leading-[14]" style={{ width: LIST_W - 56, textColor: color(row.state?.() === "focused" ? "bright_foreground" : "foreground") }}>
                {row.label}
              </Text>
              <Show when={row.state?.() === "open"}>
                <View class="absolute top-[9] h-[4] w-[4] rounded-sm" style={{ insetL: LIST_W - 14, bgColor: color("dark_foreground") }} />
              </Show>
            </View>
          )}
        </For>
      </View>
    </>
  );
}
