// Omarchy's screensaver: the text in ~/.config/omarchy/branding/screensaver.txt
// (Omarchy's logo) drawn in, held and drawn out again by effects chosen at
// random, on black across both panels, as omarchy-screensaver runs ttfx in a
// full-screen terminal. Each character is its own node; an effect sets every
// node's start values and hands the core one tween per property with its own
// delay, so the motion runs without script work per frame. Any button or touch
// ends it (the press that does is not passed on). It starts from the shell's
// idle timer (app.tsx, shell.json `idle.screensaver`) and from
// `omarchy-launch-screensaver` (`omarchy-shell pocket.screensaver start`).
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { animate, jump, type EasingName } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { request } from "../bridge.ts";
import { CJK_SLOT_12 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { serve } from "../system.ts";
import { palette } from "../theme.ts";

const [active, setActive] = createSignal(false);
const [text, setText] = createSignal("");

export const screensaverActive = active;

export function startScreensaver() {
  if (active()) return;
  request<string>({ method: "screensaver" }).then(
    (t) => {
      setText(t);
      setActive(true);
    },
    () => {},
  );
}

export function stopScreensaver() {
  setActive(false);
}

serve("pocket.screensaver", {
  start: () => (startScreensaver(), "ok"),
  stop: () => (stopScreensaver(), "ok"),
  status: () => (active() ? "running" : "stopped"),
});

const CELL_W = 6;
const CELL_H = 14;
const HOLD = 7;
const OUT = 1.6;

interface Cell {
  ch: string;
  col: number;
  row: number;
  x: number;
  y: number;
}

function cellsOf(source: string): { cells: Cell[]; cols: number } {
  const lines = source.split("\n");
  const cols = Math.max(1, ...lines.map((l) => [...l].length));
  const left = Math.round((512 - cols * CELL_W) / 2);
  const top = Math.round((384 - lines.length * CELL_H) / 2);
  const cells: Cell[] = [];
  lines.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch !== " ") cells.push({ ch, col, row, x: left + col * CELL_W, y: top + row * CELL_H });
    }),
  );
  return { cells, cols };
}

const hex = (name: string) => palette()[name] ?? "#7aa2f7";
function mix(a: string, b: string, t: number) {
  const ca = parseInt(a.slice(1, 7), 16);
  const cb = parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}

type Node = NodeMirror;
interface Effect {
  /** start values, then the tweens in; returns how long the way in takes (s) */
  enter(nodes: Node[], cells: Cell[], final: (c: Cell) => string): number;
}

const rand = (n: number) => Math.random() * n;
const tween = (n: Node, prop: "translateX" | "translateY" | "opacity" | "textColor" | "scale", to: number | string, dur: number, delay: number, easing: EasingName = "out") =>
  animate(n, prop, to, { dur, delay, easing });

const EFFECTS: Effect[] = [
  // rain: each character falls into place
  {
    enter(nodes, cells, final) {
      cells.forEach((c, i) => {
        jump(nodes[i]!, "translateY", -(c.y + CELL_H + rand(60)));
        jump(nodes[i]!, "textColor", final(c));
        tween(nodes[i]!, "translateY", 0, 650, rand(1800), "in");
      });
      return 2.5;
    },
  },
  // slide: rows come in from alternating sides
  {
    enter(nodes, cells, final) {
      cells.forEach((c, i) => {
        jump(nodes[i]!, "translateX", c.row % 2 ? 560 : -560);
        jump(nodes[i]!, "textColor", final(c));
        tween(nodes[i]!, "translateX", 0, 900, c.row * 110 + c.col * 4, "out");
      });
      return 2.4;
    },
  },
  // expand: out of the middle of the panel
  {
    enter(nodes, cells, final) {
      cells.forEach((c, i) => {
        jump(nodes[i]!, "translateX", 256 - c.x);
        jump(nodes[i]!, "translateY", 192 - c.y);
        jump(nodes[i]!, "opacity", 0);
        jump(nodes[i]!, "textColor", final(c));
        const delay = rand(500);
        tween(nodes[i]!, "translateX", 0, 1100, delay, "out-back");
        tween(nodes[i]!, "translateY", 0, 1100, delay, "out-back");
        tween(nodes[i]!, "opacity", 1, 300, delay);
      });
      return 1.8;
    },
  },
  // decrypt: the characters light white along the columns, then settle into colour
  {
    enter(nodes, cells, final) {
      const dark = hex("muted");
      const bright = hex("bright_foreground");
      cells.forEach((c, i) => {
        jump(nodes[i]!, "textColor", hex("background"));
        tween(nodes[i]!, "textColor", dark, 200, rand(600));
      });
      after(0.7, () =>
        cells.forEach((c, i) => {
          if (nodes[i]) tween(nodes[i]!, "textColor", bright, 120, c.col * 16 + rand(160));
        }),
      );
      after(1.9, () =>
        cells.forEach((c, i) => {
          if (nodes[i]) tween(nodes[i]!, "textColor", final(c), 500, c.col * 16);
        }),
      );
      return 3.8;
    },
  },
  // wipe: a diagonal reveal from the top left
  {
    enter(nodes, cells, final) {
      cells.forEach((c, i) => {
        jump(nodes[i]!, "opacity", 0);
        jump(nodes[i]!, "scale", 2.5);
        jump(nodes[i]!, "textColor", final(c));
        const delay = (c.col + c.row * 4) * 14;
        tween(nodes[i]!, "opacity", 1, 200, delay);
        tween(nodes[i]!, "scale", 1, 400, delay, "out");
      });
      return 2.3;
    },
  },
  // spray: thrown up from the bottom edge
  {
    enter(nodes, cells, final) {
      cells.forEach((c, i) => {
        jump(nodes[i]!, "translateX", 256 - c.x + rand(80) - 40);
        jump(nodes[i]!, "translateY", 400 - c.y);
        jump(nodes[i]!, "opacity", 0);
        jump(nodes[i]!, "textColor", final(c));
        const delay = rand(1600);
        tween(nodes[i]!, "translateX", 0, 800, delay, "out");
        tween(nodes[i]!, "translateY", 0, 800, delay, "out");
        tween(nodes[i]!, "opacity", 1, 150, delay);
      });
      return 2.6;
    },
  },
];

/** The way out: fall off the panel, or fade. */
function leave(nodes: Node[], cells: Cell[]) {
  const fall = Math.random() < 0.5;
  cells.forEach((c, i) => {
    if (!nodes[i]) return;
    if (fall) tween(nodes[i]!, "translateY", 420 - c.y, 700, rand(900), "in");
    else tween(nodes[i]!, "opacity", 0, 400, rand(1000));
  });
}

/** Back to the resting state an effect starts from. */
function reset(nodes: Node[], cells: Cell[]) {
  cells.forEach((_, i) => {
    const n = nodes[i];
    if (!n) return;
    for (const [prop, value] of [["translateX", 0], ["translateY", 0], ["opacity", 1], ["scale", 1]] as const) jump(n, prop, value);
  });
}

function Art() {
  const { cells, cols } = cellsOf(text());
  const nodes: Node[] = [];
  const from = hex("accent");
  const to = hex("magenta");
  const final = (c: Cell) => mix(from, to, c.col / Math.max(1, cols - 1));
  const font = cjk(text(), CJK_SLOT_12);
  let running = true;
  let last = -1;
  onCleanup(() => (running = false));
  const cycle = () => {
    if (!running) return;
    reset(nodes, cells);
    let pick = Math.floor(rand(EFFECTS.length));
    if (pick === last) pick = (pick + 1) % EFFECTS.length;
    last = pick;
    const enter = EFFECTS[pick]!.enter(nodes, cells, final);
    after(enter + HOLD, () => {
      if (!running) return;
      leave(nodes, cells);
      after(OUT + 0.4, cycle);
    });
  };
  onMount(() => after(0.05, cycle));
  return (
    <For each={cells}>
      {(c, i) => (
        <Text
          ref={(n: NodeMirror) => (nodes[i()] = n)}
          class="absolute font-mono text-xs leading-[14]"
          style={{ insetL: c.x, insetT: c.y, textColor: "#000000", ...font }}
        >
          {c.ch}
        </Text>
      )}
    </For>
  );
}

/** The stage's half; the deck goes black with ScreensaverDeck. */
export function Screensaver() {
  return (
    <Show when={active()}>
      <View class="absolute left-0 top-0 w-[512] h-[384] overflow-hidden" style={{ bgColor: "#000000" }}>
        <Art />
      </View>
    </Show>
  );
}

export function ScreensaverDeck() {
  return <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ bgColor: "#000000" }} />;
}
