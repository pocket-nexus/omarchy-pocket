// The deck's home layout: the stage at MAP_SCALE, live, between the
// workspaces and the panels. It shows while nothing has focus, and when the
// Home tab asks for it. A press on a window focuses it, and the deck becomes
// that window's keyboard or pad; a press on a workspace tab switches to it;
// the layout badge toggles dwindle and scrolling; a press in the right column
// opens that panel's card on the stage. Under the map and as wide as it, the
// pinned apps (deck/pins.ts): a press opens one, or focuses its window when it
// is a package or applet already open. Pins are edited here, on the deck: the
// last cell (+) turns the map into every app, two columns that scroll; a tap
// there pins or unpins an app, a press on a pin in the row unpins it, and the
// last cell (now ✓) puts the map back. Moving, swapping, resizing and closing
// windows are the gamepad's chords (chords.ts), not gestures here.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { perform } from "../actions.ts";
import { layout as deckLayout } from "../focus.ts";
import { inkShift } from "../ink.ts";
import type { MenuItem } from "../menu.ts";
import { allApps, openItem, refreshApps } from "../stage/menu.tsx";
import { createList, List } from "./list.tsx";
import { MAX_PINS, PIN, pinIds, togglePin } from "./pins.ts";
import { flip, TOP_LEFT, type Box } from "../motion.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BAR_H, sameRect, STAGE_H, STAGE_W } from "../wm.ts";
import { act, barPosition, current, find, focus, focused, focusWindow, layout, occupied, placements, visibleWindows, windowAt, WORKSPACES, type Win } from "../workspaces.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { closePanel, openPanel, showPanel, type PanelName } from "../stage/panels.tsx";
import { state } from "../system.ts";
import { pressAt, pressed } from "./press.ts";
import { DECK_W } from "../screen.ts";
import { BODY_H } from "./geometry.ts";

/** A cell of the layout, in body coordinates. */
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}
const inCell = (c: Cell, x: number, y: number) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;

const PANEL_LIST: PanelName[] = ["tailscale", "proxy", "bluetooth", "network", "audio", "power"];
const panels = () => PANEL_LIST.filter((p) => (p !== "proxy" || state()?.proxy) && (p !== "tailscale" || state()?.tailscale));

/**
 * Two arrangements of the same parts.
 *
 * The RG DS Plus's 512-point deck holds the stage at 0.7 between two
 * columns, the workspaces and the layout on the left and the panels on the
 * right, each as tall as the map, with the pins in a row of icons under it.
 *
 * A narrower deck (the AYN Thor's 413 x 326-point body) has no room for
 * columns beside a 16:9 stage. Its parts follow Omarchy's bar instead: one
 * row along the top with the workspaces and the layout on the left and the
 * panels on the right, the map across the width under it (0.62), and the
 * pins in a row of icons along the bottom edge.
 */
const COMPACT = DECK_W < 480;
const CELL_GAP = 6;

// the RG DS Plus: the columns
const SIDE_W = 60;
const COLUMN_ROW = 40;
const COLUMN_TOP = 28;

// a compact deck: the top row and the bottom row
const EDGE = 6;
const TAB_H = 36;
const TAB_GAP = 4;
/** between the workspaces' group and the panels' */
const TAB_SPLIT = 12;
/** the layout badge is this many tabs wide: it says "scroll" */
const BADGE_UNITS = 1.4;
const DOCK_H = 40;
const DOCK_Y = BODY_H - EDGE - DOCK_H;
const MAP_ROOM_Y = EDGE + TAB_H + CELL_GAP;
const MAP_ROOM_H = DOCK_Y - CELL_GAP - MAP_ROOM_Y;

/** The stage on the deck: 0.7 on the RG DS Plus, as large as the room
 *  between the rows allows on a compact deck. */
export const MAP_SCALE = COMPACT ? Math.min(MAP_ROOM_H / STAGE_H, (DECK_W - 2 * EDGE) / STAGE_W) : 0.7;
const MAP_W = STAGE_W * MAP_SCALE;
const MAP_H = STAGE_H * MAP_SCALE;
const MAP_X = (DECK_W - MAP_W) / 2;
const MAP_Y = COMPACT ? MAP_ROOM_Y + (MAP_ROOM_H - MAP_H) / 2 : COLUMN_TOP;
const LEFT_X = (MAP_X - SIDE_W) / 2;
const RIGHT_X = DECK_W - LEFT_X - SIDE_W;

/** a top-row tab's width: the five workspaces, the badge and `n` panels share the row */
const tabW = (n: number) => (DECK_W - 2 * EDGE - TAB_SPLIT - (4 + n) * TAB_GAP) / (5 + BADGE_UNITS + n);
/** the workspace tab `i`, or the layout badge at `WORKSPACES` */
const leftCell = (i: number): Cell => {
  if (!COMPACT) return { x: LEFT_X, y: COLUMN_TOP + i * (COLUMN_ROW + CELL_GAP), w: SIDE_W, h: COLUMN_ROW };
  const w = tabW(panels().length);
  return { x: EDGE + i * (w + TAB_GAP), y: EDGE, w: i === WORKSPACES ? w * BADGE_UNITS : w, h: TAB_H };
};
/** the panel `i` of `n`: the right column, or the top row's right end */
const panelCell = (i: number, n: number): Cell => {
  if (!COMPACT) return { x: RIGHT_X, y: COLUMN_TOP + i * (COLUMN_ROW + CELL_GAP), w: SIDE_W, h: COLUMN_ROW };
  const w = tabW(n);
  const left = DECK_W - EDGE - n * w - (n - 1) * TAB_GAP;
  return { x: left + i * (w + TAB_GAP), y: EDGE, w, h: TAB_H };
};
/** the workspace tab under body point (x, y), or -1 */
const wsTabAt = (x: number, y: number) => Array.from({ length: WORKSPACES }, (_, i) => i).find((i) => inCell(leftCell(i), x, y)) ?? -1;
const onBadge = (x: number, y: number) => inCell(leftCell(WORKSPACES), x, y);
/** the panel under body point (x, y) */
const panelAt = (x: number, y: number): PanelName | undefined => {
  const list = panels();
  return list.find((_, i) => inCell(panelCell(i, list.length), x, y));
};
const panelGlyph = (p: PanelName) => {
  const s = state();
  return p === "tailscale" ? "\u{f0318}" : p === "proxy" ? "\u{f0582}" : p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
};

/** The pinned apps: a row of icons, seven cells at most (six pins and the
 *  add cell), a shorter row centred. On the RG DS Plus the row is exactly as
 *  wide as the map, under it; on a compact deck it sits on the body's bottom
 *  edge, as far from it as the top row is from the strip. */
const PIN_GAP = 6;
const PIN_W = COMPACT ? 52 : (MAP_W - MAX_PINS * PIN_GAP) / (MAX_PINS + 1);
const PIN_H = COMPACT ? DOCK_H : 40;
const PIN_Y = COMPACT ? DOCK_Y : MAP_Y + MAP_H + 7;
const PIN_STEP = PIN_W + PIN_GAP;
const ADD = "\u{f0415}";
const DONE = "\u{f012c}";
const REMOVE = "\u{f0156}";
const pinned = (): MenuItem[] => {
  const apps = allApps();
  return pinIds(apps).flatMap((id) => apps.find((a) => a.id === id) ?? []);
};
/** the cells: the pins, then the add cell */
const pinCells = (): Cell[] => {
  const n = pinned().length + 1;
  const left = DECK_W / 2 - ((n - 1) * PIN_STEP + PIN_W) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: left + i * PIN_STEP, y: PIN_Y, w: PIN_W, h: PIN_H }));
};
/** the cell under body point (x, y): a pin's index, the add cell's (pins' count), or -1 */
const pinAt = (x: number, y: number) => pinCells().findIndex((c) => inCell(c, x, y));

/** While pins are edited, the map's place holds every app. */
const [editing, setEditing] = createSignal(false);
const EDIT_PAD = 4;
const APP_H = 33;
const APP_W = (MAP_W - 2 * EDIT_PAD) / 2;
const APP_ROWS = Math.floor((MAP_H - 2 * EDIT_PAD) / APP_H);
const appList = createList(APP_H, MAP_Y + EDIT_PAD, APP_ROWS);
/** the apps two to a row */
const appRows = () => {
  const apps = allApps();
  return Array.from({ length: Math.ceil(apps.length / 2) }, (_, i) => [apps[2 * i]!, apps[2 * i + 1]] as const);
};
/** the app under body point (x, y) while editing, by index in allApps, or -1 */
const appAt = (x: number, y: number) => {
  if (!onMap(x, y) || y < MAP_Y + EDIT_PAD) return -1;
  const row = appList.first() + Math.floor((y - MAP_Y - EDIT_PAD) / APP_H);
  const i = 2 * row + (x >= MAP_X + EDIT_PAD + APP_W ? 1 : 0);
  return i < allApps().length ? i : -1;
};
const full = () => pinIds(allApps()).length >= MAX_PINS;
function editPins(on: boolean) {
  if (on) appList.reset();
  setEditing(on);
}
/** A tap on an app while editing: pins it, or unpins it; a full row takes no more. */
function toggleApp(item: MenuItem) {
  const apps = allApps();
  if (pinIds(apps).includes(item.id) || !full()) togglePin(item, apps);
}

/** A pin opens its app, or focuses the package already open in a window. */
function openPin(item: MenuItem) {
  const open = item.applet ? find((w) => w.kind === "app" && w.path === item.applet) : null;
  if (open) return focusWindow(open.id);
  openItem(item);
}

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
  const pin = pinAt(x, y);
  if (pin >= 0) return `home:pin${pin}`;
  if (editing()) {
    const app = appAt(x, y);
    return app >= 0 ? `home:app${app}` : null;
  }
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
  const pin = pinAt(x, y);
  if (pin >= 0) {
    const item = pinned()[pin];
    if (!item) return editPins(!editing());
    return editing() ? togglePin(item, allApps()) : openPin(item);
  }
  // the app list takes its taps at the lift, so a drag can scroll it
  if (editing()) return;
  if (onMap(x, y)) {
    const at = toStage(x, y);
    const id = windowAt(at.x, at.y);
    if (id !== null) act((m) => m.focusWin(id));
  }
}

/** The home layout's fingers this frame (body coordinates): a finger acts
 *  where it settles; on the app list it scrolls, and acts at a lift that did
 *  not travel. */
export function homeTouch(frame: TouchFrame) {
  const c = frame.down[0];
  pressAt(c && !c.moved ? homeTarget(c.x, c.y) : null);
  if (editing()) {
    const listed = (t: { start: { x: number; y: number } }) => onMap(t.start.x, t.start.y);
    appList.touch({ ...frame, down: frame.down.filter(listed), taps: [] }, appRows().length, () => {});
    for (const t of frame.taps) {
      const i = !t.moved && listed(t) ? appAt(t.x, t.y) : -1;
      if (i >= 0) toggleApp(allApps()[i]!);
    }
  }
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

/** One cell of the pins: the app's icon, drawn as the panels draw theirs;
 *  while editing, a pin wears a small × in its corner. */
function PinCell(props: { cell: Cell; icon: string; target: string; tone?: "dim" | "accent"; removable?: boolean }) {
  return (
    <View class="absolute rounded-md" style={{ insetL: props.cell.x, insetT: props.cell.y, width: props.cell.w, height: props.cell.h, bgColor: color(pressed(props.target) ? "selection" : "dark_background") }}>
      <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: props.cell.h / 2 - 9, insetL: -inkShift(props.icon, 16), width: props.cell.w, textColor: color(props.tone === "dim" ? "dark_foreground" : props.tone === "accent" ? "accent" : "foreground") }}>
        {props.icon}
      </Text>
      <Show when={props.removable}>
        <Text class="absolute top-[1] w-[12] text-center font-mono text-xs leading-[12]" style={{ insetL: props.cell.w - 13, textColor: color("dark_foreground") }}>
          {REMOVE}
        </Text>
      </Show>
    </View>
  );
}

/** One app in the list: its icon and name, lit when it is pinned, dim when the row is full. */
function AppCell(props: { item: MenuItem; x: number; index: number }) {
  const on = () => pinIds(allApps()).includes(props.item.id);
  const tone = () => (on() ? "accent" : full() ? "muted" : "foreground");
  return (
    <View class="absolute top-[1] rounded-sm" style={{ insetL: props.x, width: APP_W - 2, height: APP_H - 2, bgColor: color(pressed(`home:app${props.index}`) ? "selection" : on() ? "background" : "dark_background") }}>
      <Text class="absolute top-[7] w-[20] text-center font-mono text-base leading-[18]" style={{ insetL: 8 - inkShift(props.item.icon, 16), textColor: color(tone()) }}>
        {props.item.icon}
      </Text>
      <Text class="absolute left-[34] top-[9] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ width: APP_W - 60, textColor: color(on() ? "bright_foreground" : tone()) }}>
        {props.item.label}
      </Text>
      <Show when={on()}>
        <Text class="absolute top-[8] w-[16] text-center font-mono text-xs leading-[16]" style={{ insetL: APP_W - 24 - inkShift(PIN, 12), textColor: color("accent") }}>
          {PIN}
        </Text>
      </Show>
    </View>
  );
}

/** Every app, two columns over the map's place while pins are edited. */
function AppList() {
  return (
    <View class="absolute overflow-hidden rounded-sm" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H, bgColor: color("darker_background"), opacity: editing() ? 1 : 0 }}>
      <List state={appList} items={appRows} top={EDIT_PAD} rowH={APP_H} left={EDIT_PAD} width={MAP_W - 2 * EDIT_PAD} selected={() => -1}>
        {(row, i) => (
          <>
            <AppCell item={row()[0]} x={0} index={2 * i} />
            <Show when={row()[1]}>{(second) => <AppCell item={second()} x={APP_W} index={2 * i + 1} />}</Show>
          </>
        )}
      </List>
    </View>
  );
}

export function Home() {
  const bar = () => barPosition();
  // an app installed since the menu last looked shows up as a pin; leaving
  // Home ends an edit
  createEffect(on(deckLayout, (l) => (l === "home" ? refreshApps() : editPins(false)), { defer: true }));
  return (
    <>
      <View class="absolute overflow-hidden rounded-sm" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H, bgColor: color("dark_background") }}>
        <Show when={bar() !== "none"}>
          <View class="absolute left-0" style={{ insetT: bar() === "bottom" ? MAP_H - BAR_H * MAP_SCALE : 0, width: MAP_W, height: BAR_H * MAP_SCALE, bgColor: color("background") }} />
        </Show>
        <For each={visibleWindows()}>{(win) => <Tile win={win} />}</For>
        <Show when={visibleWindows().length === 0}>
          <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: MAP_H / 2 - 7, width: MAP_W, textColor: color("dark_foreground") }}>
            No windows
          </Text>
        </Show>
      </View>
      <AppList />
      <For each={pinned()}>{(item, i) => <PinCell cell={pinCells()[i()]!} icon={item.icon} target={`home:pin${i()}`} removable={editing()} />}</For>
      <PinCell cell={pinCells()[pinned().length]!} icon={editing() ? DONE : ADD} target={`home:pin${pinned().length}`} tone={editing() ? "accent" : "dim"} />
      <For each={Array.from({ length: WORKSPACES }, (_, i) => i)}>
        {(n) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: leftCell(n).x, insetT: leftCell(n).y, width: leftCell(n).w, height: leftCell(n).h, bgColor: color(current() === n || pressed(`home:ws${n}`) ? "selection" : "dark_background") }}
          >
            <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: leftCell(n).h / 2 - 8, width: leftCell(n).w, textColor: color(current() === n ? "accent" : occupied(n) ? "foreground" : "muted") }}>
              {String(n + 1)}
            </Text>
          </View>
        )}
      </For>
      <View class="absolute rounded-md" style={{ insetL: leftCell(WORKSPACES).x, insetT: leftCell(WORKSPACES).y, width: leftCell(WORKSPACES).w, height: leftCell(WORKSPACES).h, bgColor: color(pressed("home:layout") ? "selection" : "background") }}>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: leftCell(WORKSPACES).h / 2 - 7, width: leftCell(WORKSPACES).w, textColor: color("dark_foreground") }}>
          {layout() === "dwindle" ? "tile" : "scroll"}
        </Text>
      </View>
      <For each={panels()}>
        {(p, i) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: panelCell(i(), panels().length).x, insetT: panelCell(i(), panels().length).y, width: panelCell(i(), panels().length).w, height: panelCell(i(), panels().length).h, bgColor: color(openPanel() === p || pressed(`home:${p}`) ? "selection" : "dark_background") }}
          >
            <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: panelCell(i(), panels().length).h / 2 - 9, insetL: -inkShift(panelGlyph(p), 16), width: panelCell(i(), panels().length).w, textColor: color(openPanel() === p ? "accent" : (p === "proxy" && state()?.proxy?.running === false) || (p === "tailscale" && state()?.tailscale?.state !== "Running") ? "muted" : "foreground") }}>
              {panelGlyph(p)}
            </Text>
          </View>
        )}
      </For>
    </>
  );
}
