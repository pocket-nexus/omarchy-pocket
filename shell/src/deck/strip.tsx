// The deck's function row, along the hinge as on a laptop: Omarchy's logo
// (opens the menu, as L1 + A does) and Esc at the left, Home at the right, and
// between them the keys what has focus wants at one press. A terminal gets Tab
// and its control keys; a touch app gets Back, which it hears as the Cross
// button; anything else gets the workspaces' steps. While a pinyin composition
// is open (the 中 key, term/ime.ts) the row holds its preedit and candidates.
import { createMemo, createRoot, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { perform, toggleMenu } from "../actions.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { keySink, layout, toggleHome } from "../focus.ts";
import { cjk } from "../glyphs.ts";
import { fieldSink } from "../keys.ts";
import { appletTyping, pressBack } from "../packages.ts";
import { card } from "../stage/card.tsx";
import { menuOpen } from "../stage/menu.tsx";
import { composing, pick, snapshot } from "../term/ime.ts";
import { openTerminal } from "../term/store.ts";
import { sendCtrl, sendKey } from "../term/keyboard.tsx";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { focused } from "../workspaces.ts";
import { STRIP_H } from "./geometry.ts";
import { pressed } from "./press.ts";

const LOGO = "\u{e900}";
const HOME = "\u{f02dc}";
const CLOSE = "\u{f0156}";
const LEFT = "\u{f0141}";
const RIGHT = "\u{f0142}";
const TERMINAL = "\u{f018d}";

const EDGE = 4;
const GAP = 4;
const CHIP_H = 28;
const CHIP_Y = 3;
const LOGO_W = 36;
const ESC_W = 44;
const END_W = 40;
const MAX_W = 84;
/** the preedit's width, then five candidates */
const PREEDIT_W = 132;
const CANDIDATE_W = (512 - PREEDIT_W) / 5;

interface Chip {
  id: string;
  label: string;
  /** a Nerd Font glyph before the label, or the whole label */
  glyph?: string;
  run: () => void;
  lit?: () => boolean;
  danger?: boolean;
}
interface Placed extends Chip {
  x: number;
  w: number;
}

const ctrl = (ch: string): Chip => ({ id: `ctrl-${ch}`, label: `^${ch.toUpperCase()}`, run: () => sendCtrl(ch) });
const TAB: Chip = { id: "tab", label: "Tab", run: () => sendKey("Tab") };
const PREV: Chip = { id: "ws-prev", label: "WS", glyph: LEFT, run: () => perform("ws.prev") };
const NEXT: Chip = { id: "ws-next", label: "WS", glyph: RIGHT, run: () => perform("ws.next") };

/** The middle of the row, for what has focus. */
function context(): Chip[] {
  if (fieldSink()) return [];
  if (card()) return [TAB];
  const w = focused();
  if (!w) return [PREV, NEXT, { id: "terminal", label: "Terminal", glyph: TERMINAL, run: () => openTerminal() }, { id: "layout", label: "Layout", run: () => perform("layout") }];
  if (w.kind === "terminal") return [TAB, ctrl("c"), ctrl("d"), ctrl("l"), ctrl("r")];
  if (w.kind === "app") return appletTyping(w.app) ? [TAB, PREV, NEXT] : [{ id: "back", label: "Back", glyph: LEFT, run: pressBack }, PREV, NEXT];
  return [TAB, PREV, NEXT];
}

const closes = () => keySink().close;
const row = createRoot(() =>
  createMemo((): Placed[] => {
    const close = closes();
    const start: Chip[] = [
      { id: "menu", label: "", glyph: LOGO, run: toggleMenu, lit: menuOpen },
      { id: "esc", label: "Esc", run: () => sendKey("Escape") },
    ];
    const end: Chip[] = [
      ...(close ? [{ id: "close", label: "", glyph: CLOSE, run: () => keySink().close?.(), danger: true }] : []),
      { id: "home", label: "", glyph: HOME, run: toggleHome, lit: () => layout() === "home" },
    ];
    const middle = context();
    const ends = LOGO_W + ESC_W + end.length * END_W;
    const room = 512 - 2 * EDGE - ends - (2 + middle.length + end.length - 1) * GAP;
    const w = middle.length ? Math.min(MAX_W, Math.floor(room / middle.length)) : 0;
    let x = EDGE;
    const place = (chip: Chip, width: number): Placed => {
      const placed = { ...chip, x, w: width };
      x += width + GAP;
      return placed;
    };
    const out = [place(start[0]!, LOGO_W), place(start[1]!, ESC_W), ...middle.map((c) => place(c, w))];
    x = 512 - EDGE - end.length * END_W - (end.length - 1) * GAP;
    return [...out, ...end.map((c) => place(c, END_W))];
  }),
);

const chipAt = (x: number) => row().find((c) => x >= c.x - GAP / 2 && x < c.x + c.w + GAP / 2);

/** The row's target under `x`, for the pressed look. */
export function stripTarget(x: number): string | null {
  if (composing()) return null;
  const chip = chipAt(x);
  return chip ? `strip:${chip.id}` : null;
}

/** The row's fingers this frame: a press acts on the chip or the candidate under it. */
export function stripTouch(frame: TouchFrame) {
  for (const c of frame.presses) {
    if (composing()) {
      if (c.x >= PREEDIT_W) pick(Math.floor((c.x - PREEDIT_W) / CANDIDATE_W), (text) => keySink().text(text));
      continue;
    }
    chipAt(c.x)?.run();
  }
}

export function Strip() {
  return (
    <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: STRIP_H }}>
      <Show
        when={composing()}
        fallback={
          <For each={row()}>
            {(chip) => {
              const lit = () => chip.lit?.() === true;
              return (
                <View class="absolute rounded-md" style={{ insetL: chip.x, insetT: CHIP_Y, width: chip.w, height: CHIP_H, bgColor: color(lit() || pressed(`strip:${chip.id}`) ? "selection" : "dark_background") }}>
                  <Show when={chip.glyph && chip.label}>
                    <Text class="absolute top-[6] w-[16] text-center font-mono text-xs leading-[16]" style={{ insetL: 6, textColor: color("foreground") }}>
                      {chip.glyph}
                    </Text>
                  </Show>
                  <Text
                    class={chip.id === "menu" ? "absolute left-0 top-[8] h-[16] overflow-hidden text-center font-mono text-sm leading-[16]" : "absolute left-0 top-[6] h-[16] overflow-hidden text-center font-mono text-xs leading-[16]"}
                    style={{ width: chip.w, ...(chip.glyph && chip.label ? { insetL: 11 } : {}), textColor: color(chip.danger ? "red" : lit() ? "accent" : "foreground") }}
                  >
                    {chip.label || chip.glyph}
                  </Text>
                </View>
              );
            }}
          </For>
        }
      >
        <View class="absolute left-0 top-0 w-[512]" style={{ height: STRIP_H, bgColor: color("dark_background") }}>
          <Text class="absolute left-[10] top-[8] h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ width: PREEDIT_W - 14, textColor: color("accent"), ...cjk(snapshot()?.preedit ?? "", CJK_SLOT_14) }}>
            {snapshot()?.preedit ?? ""}
          </Text>
          <For each={snapshot()?.candidates ?? []}>
            {(candidate, i) => (
              <Text
                class="absolute top-[8] h-[18] overflow-hidden text-center font-mono text-sm leading-[18]"
                style={{ insetL: PREEDIT_W + i() * CANDIDATE_W, width: CANDIDATE_W - 4, textColor: color(i() === 0 ? "bright_foreground" : "foreground"), ...cjk(candidate, CJK_SLOT_14) }}
              >
                {candidate}
              </Text>
            )}
          </For>
        </View>
      </Show>
    </View>
  );
}
