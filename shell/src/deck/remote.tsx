// The deck while a card is up on the stage: its remote, as a 3DS's touch
// screen serves the picture above it. The top panel takes no touch, so the
// card is worked from here or from the gamepad, never both ways at once on
// different things: the pad scrubs the card's selection a row for each STEP
// points a finger travels, and a tap on it is A; the buttons beside it are
// the card's own (the menu: Open, Back, Close; a panel: Select, − and +,
// Forget for Network and Bluetooth, Close; the proxy: Test, Previous, Next,
// Close; the picker: Apply, Cancel). The rail on the pad's edge shows
// where the selection is in the list and glides when it moves.
import { createEffect, createSignal, For, on, untrack } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { C } from "../classes.ts";
import { glide } from "../motion.ts";
import { card, cardPosition, cardPress, closeCard, type CardKind } from "../stage/card.tsx";
import { openPanel } from "../stage/panels.tsx";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BODY_H } from "./geometry.ts";

interface Button {
  id: string;
  mark: string;
  label: string;
  act(): void;
}

const press = (key: number) => () => cardPress(key);
const BUTTONS: Record<CardKind, Button[]> = {
  menu: [
    { id: "open", mark: "A", label: "Open", act: press(BTN.CIRCLE) },
    { id: "back", mark: "B", label: "Back", act: press(BTN.CROSS) },
    { id: "close", mark: "", label: "Close", act: closeCard },
  ],
  panel: [
    { id: "select", mark: "A", label: "Select", act: press(BTN.CIRCLE) },
    { id: "less", mark: "\u{2190}", label: "Less", act: press(BTN.LEFT) },
    { id: "more", mark: "\u{2192}", label: "More", act: press(BTN.RIGHT) },
    { id: "forget", mark: "Y", label: "Forget", act: press(BTN.SQUARE) },
    { id: "close", mark: "B", label: "Close", act: press(BTN.CROSS) },
  ],
  picker: [
    { id: "apply", mark: "A", label: "Apply", act: press(BTN.CIRCLE) },
    { id: "cancel", mark: "B", label: "Cancel", act: press(BTN.CROSS) },
  ],
};

const STEP = 26;
const PAD = { x: 12, y: 32, w: 330, h: BODY_H - 32 - 10 };
const COL = { x: PAD.x + PAD.w + 10, w: 512 - (PAD.x + PAD.w + 10) - 12 };
const GAP = 6;
const THUMB_H = 30;
const RAIL_X = PAD.w - 14;

/** the proxy's rows: A tests a group, left and right pick its node */
const PROXY: Button[] = [
  { id: "select", mark: "A", label: "Test", act: press(BTN.CIRCLE) },
  { id: "less", mark: "\u{2190}", label: "Previous", act: press(BTN.LEFT) },
  { id: "more", mark: "\u{2192}", label: "Next", act: press(BTN.RIGHT) },
  { id: "close", mark: "B", label: "Close", act: press(BTN.CROSS) },
];
const buttons = () => {
  const kind = card() ?? "menu";
  if (kind !== "panel") return BUTTONS[kind];
  const panel = openPanel();
  if (panel === "proxy") return PROXY;
  // only saved networks and paired devices can be forgotten
  return BUTTONS.panel.filter((b) => b.id !== "forget" || panel === "network" || panel === "bluetooth");
};
const buttonH = (n: number) => Math.min(60, (PAD.h - GAP * (n - 1)) / n);
const buttonAt = (x: number, y: number) => {
  const list = buttons();
  const h = buttonH(list.length);
  if (x < COL.x || x >= COL.x + COL.w || y < PAD.y) return null;
  const i = Math.floor((y - PAD.y) / (h + GAP));
  return i < list.length && y - PAD.y - i * (h + GAP) < h ? list[i]! : null;
};
const inPad = (x: number, y: number) => x >= PAD.x && x < PAD.x + PAD.w && y >= PAD.y && y < PAD.y + PAD.h;

const [lit, setLit] = createSignal<string | null>(null);
/** travel not yet spent on a step, per finger */
const travel = new Map<number, number>();

/** The remote's fingers (body coordinates). */
export function remoteTouch(frame: TouchFrame) {
  const first = frame.down[0];
  setLit(first && !first.moved ? (buttonAt(first.start.x, first.start.y)?.id ?? (inPad(first.start.x, first.start.y) ? "pad" : null)) : null);
  for (const c of frame.down) {
    if (!inPad(c.start.x, c.start.y) || !c.moved) continue;
    let spent = (travel.get(c.id) ?? 0) + c.dy;
    while (Math.abs(spent) >= STEP) {
      cardPress(spent > 0 ? BTN.DOWN : BTN.UP);
      spent -= Math.sign(spent) * STEP;
    }
    travel.set(c.id, spent);
  }
  for (const t of frame.taps) {
    travel.delete(t.id);
    if (t.moved) continue;
    if (inPad(t.start.x, t.start.y)) cardPress(BTN.CIRCLE);
    else buttonAt(t.start.x, t.start.y)?.act();
  }
}

export function Remote() {
  let thumb: NodeMirror | undefined;
  const position = () => cardPosition() ?? { title: "", at: 0, count: 0 };
  const thumbY = () => {
    const p = position();
    return 6 + (p.count > 1 ? (p.at / (p.count - 1)) * (PAD.h - THUMB_H - 12) : 0);
  };
  const startY = untrack(thumbY);
  createEffect(on(thumbY, (y) => glide(thumb, "translateY", y, 110), { defer: true }));
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{position().title}</Text>
      <Text class="absolute right-[12] top-[7] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
        {position().count ? `${position().at + 1} / ${position().count}` : ""}
      </Text>
      <View class="absolute rounded-lg" style={{ insetL: PAD.x, insetT: PAD.y, width: PAD.w, height: PAD.h, bgColor: color(lit() === "pad" ? "selection" : "dark_background") }}>
        <Text class="absolute left-0 text-center font-mono text-sm leading-[18]" style={{ insetT: PAD.h / 2 - 28, width: PAD.w - 20, textColor: color("foreground") }}>
          {"\u{2191} drag \u{2193}"}
        </Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 - 2, width: PAD.w - 20, textColor: color("dark_foreground") }}>
          {"choose on the top screen"}
        </Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 + 16, width: PAD.w - 20, textColor: color("dark_foreground") }}>
          {"tap to open"}
        </Text>
        <View class="absolute w-[4] rounded-sm" style={{ insetL: RAIL_X, insetT: 6, height: PAD.h - 12, bgColor: color("muted") }} />
        <View class="absolute w-[8] rounded-sm" style={{ insetL: RAIL_X - 2, insetT: 0, height: THUMB_H, translateY: startY, bgColor: color("accent") }} ref={(n: NodeMirror) => (thumb = n)} />
      </View>
      <For each={buttons()}>
        {(b, i) => (
          <View
            class="absolute rounded-md"
            style={{ insetL: COL.x, insetT: PAD.y + i() * (buttonH(buttons().length) + GAP), width: COL.w, height: buttonH(buttons().length), bgColor: color(lit() === b.id ? "accent" : "dark_background") }}
          >
            <Text class="absolute left-[12] font-mono text-base leading-[18]" style={{ insetT: buttonH(buttons().length) / 2 - 9, textColor: color(lit() === b.id ? "background" : "accent") }}>
              {b.mark}
            </Text>
            <Text class="absolute left-[40] font-mono text-sm leading-[16]" style={{ insetT: buttonH(buttons().length) / 2 - 8, textColor: color(lit() === b.id ? "background" : "foreground") }}>
              {b.label}
            </Text>
          </View>
        )}
      </For>
    </View>
  );
}
