// The pad layout's dock: the pins along the bottom of the body, between Hold
// and Close, with the trackpad above them (deck/geometry.ts). The workspaces,
// the layout badge and the bar's panels are in the function row in this
// layout (deck/strip.tsx).
//
// A press on a pin opens its app (deck/pins.ts), or focuses its window when it
// is a package already open. Pins are edited here: the last cell (+) lists
// every app where the trackpad was, two columns that scroll; a tap there pins
// or unpins an app, a press on a pin in the row unpins it, and the last cell
// (now ✓) gives the trackpad back.
//
// The keys layout has no room for the pins: when the keys unfold, the pins
// slide down as they fade, and they come back when the keys fold away. A
// package's own touch surface takes the whole body, so the dock stands aside
// for it too.
import { createEffect, For, on, Show, untrack } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { layout as deckLayout } from "../focus.ts";
import { inkShift } from "../ink.ts";
import type { MenuItem } from "../menu.ts";
import { glide } from "../motion.ts";
import { allApps, openItem, refreshApps } from "../stage/menu.tsx";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { find, focusWindow } from "../workspaces.ts";
import { DECK_W } from "../screen.ts";
import { BODY_H, inRect, PAD_LARGE, PIN_ROW, type Rect } from "./geometry.ts";
import { createList, List } from "./list.tsx";
import { MAX_PINS, PIN, pinIds, pinsEditing, setPinsEditing, togglePin } from "./pins.ts";
import { pressed } from "./press.ts";
import { surfacePackage } from "./touchpad.tsx";

/** The dock shows in the pad layout, unless a package's surface has the body. */
export const dockShown = () => deckLayout() === "pad" && !surfacePackage();

// ---- the pins --------------------------------------------------------------

/** Seven cells at most (six pins and the add cell), a shorter row centred. */
const PIN_GAP = 5;
const PIN_W = Math.min(52, (PIN_ROW.w - MAX_PINS * PIN_GAP) / (MAX_PINS + 1));
const ADD = "\u{f0415}";
const DONE = "\u{f012c}";
const REMOVE = "\u{f0156}";
const pinned = (): MenuItem[] => {
  const apps = allApps();
  return pinIds(apps).flatMap((id) => apps.find((a) => a.id === id) ?? []);
};
/** the cells: the pins, then the add cell */
const pinCells = (): Rect[] => {
  const n = pinned().length + 1;
  const left = PIN_ROW.x + (PIN_ROW.w - n * PIN_W - (n - 1) * PIN_GAP) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: left + i * (PIN_W + PIN_GAP), y: PIN_ROW.y, w: PIN_W, h: PIN_ROW.h }));
};
const pinAt = (x: number, y: number) => pinCells().findIndex((c) => inRect(c, x, y));

/** While pins are edited, every app, two to a row, where the trackpad was. */
const EDIT_PAD = 4;
const APP_H = 33;
const APP_W = (PAD_LARGE.w - 2 * EDIT_PAD) / 2;
const APP_ROWS = Math.floor((PAD_LARGE.h - 2 * EDIT_PAD) / APP_H);
const appList = createList(APP_H, PAD_LARGE.y + EDIT_PAD, APP_ROWS);
const appRows = () => {
  const apps = allApps();
  return Array.from({ length: Math.ceil(apps.length / 2) }, (_, i) => [apps[2 * i]!, apps[2 * i + 1]] as const);
};
/** the app under body point (x, y) while editing, by index in allApps, or -1 */
const appAt = (x: number, y: number) => {
  if (!inRect(PAD_LARGE, x, y) || y < PAD_LARGE.y + EDIT_PAD) return -1;
  const row = appList.first() + Math.floor((y - PAD_LARGE.y - EDIT_PAD) / APP_H);
  const i = 2 * row + (x >= PAD_LARGE.x + EDIT_PAD + APP_W ? 1 : 0);
  return i < allApps().length ? i : -1;
};
const full = () => pinIds(allApps()).length >= MAX_PINS;
function editPins(on: boolean) {
  if (on) appList.reset();
  setPinsEditing(on);
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

// ---- touch -----------------------------------------------------------------

/** The pressed look's target under a finger (body coordinates), or null. */
export function dockTarget(x: number, y: number, moved: boolean): string | null {
  if (!dockShown()) return null;
  const pin = pinAt(x, y);
  if (pin >= 0) return `dock:pin${pin}`;
  if (pinsEditing() && !moved) {
    const app = appAt(x, y);
    if (app >= 0) return `dock:app${app}`;
  }
  return null;
}

function tap(x: number, y: number) {
  const pin = pinAt(x, y);
  if (pin < 0) return;
  const item = pinned()[pin];
  if (!item) return editPins(!pinsEditing());
  return pinsEditing() ? togglePin(item, allApps()) : openPin(item);
}

/** The dock's fingers this frame (body coordinates): a press acts where it
 *  lands; on the app list a finger scrolls, and acts at a lift that did not
 *  travel. The trackpad takes the rest (deck/touchpad.tsx). */
export function dockTouch(frame: TouchFrame) {
  if (!dockShown()) return;
  if (pinsEditing()) {
    const listed = (t: { start: { x: number; y: number } }) => inRect(PAD_LARGE, t.start.x, t.start.y);
    appList.touch({ ...frame, down: frame.down.filter(listed), taps: [] }, appRows().length, () => {});
    for (const t of frame.taps) {
      const i = !t.moved && listed(t) ? appAt(t.x, t.y) : -1;
      if (i >= 0) toggleApp(allApps()[i]!);
    }
  }
  for (const p of frame.presses) tap(p.x, p.y);
}

// ---- drawing ---------------------------------------------------------------

/** One cell of the pins: the app's icon; while editing, a pin wears a small × in its corner. */
function PinCell(props: { cell: Rect; icon: string; target: string; tone?: "dim" | "accent"; removable?: boolean }) {
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

function PinRow() {
  return (
    <>
      <For each={pinned()}>{(item, i) => <PinCell cell={pinCells()[i()]!} icon={item.icon} target={`dock:pin${i()}`} removable={pinsEditing()} />}</For>
      <PinCell cell={pinCells()[pinned().length]!} icon={pinsEditing() ? DONE : ADD} target={`dock:pin${pinned().length}`} tone={pinsEditing() ? "accent" : "dim"} />
    </>
  );
}

/** One app in the list: its icon and name, lit when it is pinned, dim when the row is full. */
function AppCell(props: { item: MenuItem; x: number; index: number }) {
  const on = () => pinIds(allApps()).includes(props.item.id);
  const tone = () => (on() ? "accent" : full() ? "muted" : "foreground");
  return (
    <View class="absolute top-[1] rounded-sm" style={{ insetL: props.x, width: APP_W - 2, height: APP_H - 2, bgColor: color(pressed(`dock:app${props.index}`) ? "selection" : on() ? "background" : "dark_background") }}>
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

/** Every app, two columns over the trackpad while pins are edited. */
function AppList() {
  return (
    <View class="absolute overflow-hidden rounded-lg" style={{ insetL: PAD_LARGE.x, insetT: PAD_LARGE.y, width: PAD_LARGE.w, height: PAD_LARGE.h, bgColor: color("darker_background"), opacity: pinsEditing() ? 1 : 0 }}>
      <List state={appList} items={appRows} top={EDIT_PAD} rowH={APP_H} left={EDIT_PAD} width={PAD_LARGE.w - 2 * EDIT_PAD} selected={() => -1}>
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

/** how far a row travels as it folds away */
const SLIDE = 12;

export function Dock() {
  let pins: NodeMirror | undefined;
  // the pins fold away downward as the keys unfold
  createEffect(
    on(dockShown, (shown) => {
      glide(pins, "opacity", shown ? 1 : 0, 140);
      glide(pins, "translateY", shown ? 0 : SLIDE, 180);
    }, { defer: true }),
  );
  // an app installed since the menu last looked shows up among the pins;
  // folding the dock away ends an edit
  createEffect(on(dockShown, (shown) => (shown ? refreshApps() : editPins(false)), { defer: true }));
  const at = untrack(dockShown);
  return (
    <>
      {/* body coordinates: the pins' cells sit at PIN_ROW.y in it */}
      <View
        class="absolute left-0 top-0"
        style={{ width: DECK_W, height: BODY_H, opacity: at ? 1 : 0, translateY: at ? 0 : SLIDE }}
        ref={(n: NodeMirror) => (pins = n)}
      >
        <PinRow />
      </View>
      <AppList />
    </>
  );
}
