// The deck's body while a shoulder is held or a pill latched: that layer's
// chords from chords.ts, laid out like the gamepad. The D-pad, L2/R2, START
// and SELECT on the left, the face buttons X, Y, A, B on the right. Every
// button cap is a tap target (the D-pad as four arrows, L2/R2 as two halves),
// so a finger completes any chord; a tapped chord lets the pills go.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { perform } from "../actions.ts";
import { BUTTON_NAME, chordFor, dpadLabel, FACE_ORDER, LAYER_TITLE, labelFor, triggerLabel } from "../chords.ts";
import { C } from "../classes.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { layout } from "../workspaces.ts";
import { layer, releasePills } from "./layer.ts";
import { pressed } from "./press.ts";

const ROW_Y = 36;
const ROW_H = 58;
const COL_L = 8;
const COL_R = 260;
const COL_W = 244;
const CAP = 56;

interface Cap {
  id: string;
  button: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** Every tappable cap, in body coordinates. */
const CAPS: Cap[] = [
  { id: "left", button: BTN.LEFT, x: COL_L, y: ROW_Y + 12, w: 28, h: 28, label: "←" },
  { id: "up", button: BTN.UP, x: COL_L + 30, y: ROW_Y + 2, w: 28, h: 22, label: "↑" },
  { id: "down", button: BTN.DOWN, x: COL_L + 30, y: ROW_Y + 26, w: 28, h: 22, label: "↓" },
  { id: "right", button: BTN.RIGHT, x: COL_L + 60, y: ROW_Y + 12, w: 28, h: 28, label: "→" },
  { id: "l2", button: BTN.ZL, x: COL_L, y: ROW_Y + ROW_H + 6, w: 42, h: 40, label: "L2" },
  { id: "r2", button: BTN.ZR, x: COL_L + 46, y: ROW_Y + ROW_H + 6, w: 42, h: 40, label: "R2" },
  { id: "start", button: BTN.START, x: COL_L, y: ROW_Y + ROW_H * 2 + 6, w: CAP + 32, h: 40, label: "START" },
  { id: "select", button: BTN.SELECT, x: COL_L, y: ROW_Y + ROW_H * 3 + 6, w: CAP + 32, h: 40, label: "SELECT" },
  ...FACE_ORDER.map((button, i) => ({ id: `face${i}`, button, x: COL_R, y: ROW_Y + i * ROW_H + 6, w: 40, h: 40, label: BUTTON_NAME[button]! })),
];

const capAt = (x: number, y: number) => CAPS.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) ?? null;
/** The row under a point: its whole width answers, not only the cap. */
const rowCapAt = (x: number, y: number) => {
  const exact = capAt(x, y);
  if (exact) return exact;
  const row = Math.floor((y - ROW_Y) / ROW_H);
  if (row < 0 || row > 3) return null;
  if (x >= COL_R) return CAPS.find((c) => c.id === `face${row}`) ?? null;
  if (row === 2) return CAPS.find((c) => c.id === "start")!;
  if (row === 3) return CAPS.find((c) => c.id === "select")!;
  return null;
};

export const chordTarget = (x: number, y: number) => {
  const cap = rowCapAt(x, y);
  return cap && chordFor(layer(), cap.button) ? `chord:${cap.id}` : null;
};

export function chordCardTouch(frame: TouchFrame) {
  for (const tap of frame.taps) {
    if (tap.moved) continue;
    const cap = rowCapAt(tap.x, tap.y);
    const chord = cap ? chordFor(layer(), cap.button) : undefined;
    if (!chord) continue;
    releasePills();
    perform(chord.action);
  }
}

function CapView(props: { cap: Cap }) {
  const chord = () => chordFor(layer(), props.cap.button);
  const lit = () => pressed(`chord:${props.cap.id}`);
  return (
    <View class="absolute rounded-md" style={{ insetL: props.cap.x, insetT: props.cap.y, width: props.cap.w, height: props.cap.h, bgColor: color(lit() ? "accent" : chord() ? "selection" : "dark_background") }}>
      <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: props.cap.h / 2 - 7, width: props.cap.w, textColor: color(lit() ? "background" : chord() ? "bright_foreground" : "muted") }}>
        {props.cap.label}
      </Text>
    </View>
  );
}

function Label(props: { x: number; row: number; text: () => string; dim: () => boolean }) {
  const width = props.x >= COL_R ? COL_R + COL_W - props.x : COL_L + COL_W - props.x;
  return (
    <Text class="absolute h-[16] overflow-hidden font-mono text-sm leading-[16]" style={{ insetL: props.x, insetT: ROW_Y + props.row * ROW_H + 18, width, textColor: color(props.dim() ? "muted" : "foreground") }}>
      {props.text()}
    </Text>
  );
}

export function ChordCard() {
  const face = (i: number) => chordFor(layer(), FACE_ORDER[i]!);
  const side = (b: number) => chordFor(layer(), b);
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{LAYER_TITLE[layer()]}</Text>
      <Text class="absolute right-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>press a button, or tap it here</Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <For each={CAPS}>{(cap) => <CapView cap={cap} />}</For>
      <Label x={COL_L + 96} row={0} text={() => dpadLabel(layer())} dim={() => false} />
      <Label x={COL_L + 96} row={1} text={() => triggerLabel(layer(), layout())} dim={() => triggerLabel(layer(), layout()) === "—"} />
      <Label x={COL_L + 96} row={2} text={() => (side(BTN.START) ? labelFor(side(BTN.START)!.action, layout()) : "—")} dim={() => !side(BTN.START)} />
      <Label x={COL_L + 96} row={3} text={() => (side(BTN.SELECT) ? labelFor(side(BTN.SELECT)!.action, layout()) : "—")} dim={() => !side(BTN.SELECT)} />
      <For each={[0, 1, 2, 3]}>{(i) => <Label x={COL_R + 50} row={i} text={() => (face(i) ? labelFor(face(i)!.action, layout()) : "—")} dim={() => !face(i)} />}</For>
      <Show when={layer() === "workspace"}>
        <Text class="absolute left-[12] font-mono text-xs leading-[14]" style={{ insetT: ROW_Y + ROW_H * 4 + 6, textColor: color("dark_foreground") }}>
          the strip's tabs switch workspaces too; drag a window onto one to move it
        </Text>
      </Show>
    </View>
  );
}
