// The deck's top band, after the iPod touch remote's: the L1 pill, the mode
// switch, and the R1 pill. The stage's bar already shows the workspaces, the
// clock and the indicators, so the strip repeats none of them; the switch
// says what the body below is for:
//
//   Windows    the live map of the stage, its workspaces and panels
//   <window>   the focused window's remote, named after it: an applet's
//              touchpad, a terminal's arrows and control keys
//              (term-remote.tsx), a shell applet's own controls
//   Keys       the keyboard, for a window that takes keys
//
// The lit segment is the body that shows; its highlight glides between
// segments. A finger on a pill holds its layer while it stays, as the
// shoulder does; a quick tap latches it for one chord (deck/layer.ts); both
// are the workspace layer.
import { createEffect, createRoot, For, on, untrack } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { glide } from "../motion.ts";
import { appletOf, focusedApplet } from "../applets/applet.ts";
import { windowTitle } from "../stage/windows.tsx";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";
import { focused } from "../workspaces.ts";
import { body, setBody, type Body } from "./body.ts";
import { STRIP_H } from "./geometry.ts";
import type { TouchFrame } from "../touch.ts";
import { layer, pillLifted, pills, setTouched } from "./layer.ts";
import { pressed } from "./press.ts";

const PILL_W = 40;
const L_X = 4;
const R_X = 512 - 4 - PILL_W;
const SEG_W = 126;
const SEG_X = (512 - 3 * SEG_W) / 2;

/** Whether the focused window takes keys: a terminal, or an applet with a sink (Notes). */
export const takesKeys = () => focused()?.kind === "terminal" || !!focusedApplet()?.keys?.();

interface Segment {
  body: Body;
  glyph: () => string;
  label: () => string;
}
const SEGMENTS: Segment[] = [
  { body: "map", glyph: () => "\u{f056e}", label: () => "Windows" },
  {
    body: "controls",
    glyph: () => {
      const w = focused();
      return !w ? "\u{f0b8a}" : w.kind === "terminal" ? "\u{f018d}" : w.kind === "app" ? "\u{f0741}" : (appletOf(w)?.icon ?? "\u{f0b8a}");
    },
    label: () => {
      const w = focused();
      return w ? windowTitle(w) : "No window";
    },
  },
  { body: "keys", glyph: () => "\u{f030c}", label: () => "Keys" },
];

/** frames a pill tap may last and still latch */
const QUICK = 18;

const segmentAt = (x: number) => (x >= SEG_X && x < SEG_X + 3 * SEG_W ? Math.floor((x - SEG_X) / SEG_W) : -1);

/** The strip's target under `x`, for the pressed look. */
export function stripTarget(x: number): string | null {
  if (x >= L_X && x < L_X + PILL_W) return "strip:L";
  if (x >= R_X) return "strip:R";
  const i = segmentAt(x);
  return i >= 0 ? `strip:${SEGMENTS[i]!.body}` : null;
}

/** The strip's fingers this frame: the pills under a finger hold their
 *  layer, and a tap on a segment switches the body. */
export function stripTouch(frame: TouchFrame) {
  const side = (x: number) => (stripTarget(x) === "strip:L" ? "l" : stripTarget(x) === "strip:R" ? "r" : null);
  const on = { l: false, r: false };
  for (const c of frame.down) {
    const s = side(c.start.x);
    if (s) on[s] = true;
  }
  setTouched(on);
  for (const tap of frame.taps) {
    const s = side(tap.start.x);
    if (s) pillLifted(s, tap.frames, QUICK);
    else if (!tap.moved) segmentTap(tap.start.x);
  }
}

function segmentTap(x: number) {
  const target = stripTarget(x);
  if (!target) return;
  const what = target.slice(6);
  if (what === "controls" && !focused()) return toast({ icon: "\u{f02fc}", title: "No window here", body: "", tone: "info" }, 1.8);
  if (what === "keys" && !takesKeys()) return toast({ icon: "\u{f02fc}", title: "This window takes no keys", body: "", tone: "info" }, 1.8);
  setBody(what as Body);
}

function Pill(props: { x: number; label: string; on: () => boolean; target: string }) {
  return (
    <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: props.x, width: PILL_W, bgColor: color(props.on() ? "accent" : pressed(props.target) ? "selection" : "dark_background") }}>
      <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: PILL_W, textColor: color(props.on() ? "background" : "foreground") }}>
        {props.label}
      </Text>
    </View>
  );
}

/** The body the switch lights: a body that shows nothing of its own falls back to the map. */
const lit = () => {
  const b = body();
  if (b === "controls" && !focused()) return 0;
  if (b === "keys" && !takesKeys()) return 0;
  return Math.max(0, SEGMENTS.findIndex((s) => s.body === b));
};

let highlight: NodeMirror | undefined;
createRoot(() => createEffect(on(lit, (i) => glide(highlight, "translateX", i * SEG_W, 160), { defer: true })));

export function Strip() {
  const lOn = () => pills().l || layer() === "window" || layer() === "workspace";
  const rOn = () => pills().r || layer() === "move" || layer() === "workspace";
  return (
    <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: STRIP_H, bgColor: color("background") }}>
      <Pill x={L_X} label="L1" on={lOn} target="strip:L" />
      <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: SEG_X, width: 3 * SEG_W, bgColor: color("dark_background") }} />
      <View
        class="absolute top-[3] h-[20] rounded-sm"
        style={{ insetL: SEG_X, width: SEG_W, translateX: untrack(lit) * SEG_W, bgColor: color("selection") }}
        ref={(n: NodeMirror) => (highlight = n)}
      />
      <For each={SEGMENTS}>
        {(s, i) => (
          <>
            <Text class="absolute top-[4] w-[20] text-center font-mono text-sm leading-[16]" style={{ insetL: SEG_X + i() * SEG_W + 8, textColor: color(lit() === i() ? "accent" : pressed(`strip:${s.body}`) ? "foreground" : "dark_foreground") }}>
              {s.glyph()}
            </Text>
            <Text
              class="absolute top-[5] h-[14] overflow-hidden font-mono text-xs leading-[14]"
              style={{ insetL: SEG_X + i() * SEG_W + 32, width: SEG_W - 40, textColor: color(lit() === i() ? "bright_foreground" : "dark_foreground") }}
            >
              {s.label()}
            </Text>
          </>
        )}
      </For>
      <Pill x={R_X} label="R1" on={rOn} target="strip:R" />
    </View>
  );
}
