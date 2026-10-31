// The deck's top band: what the keys go to, and the three layout tabs. The
// title names the thing in focus (focus.ts): a window, the card, the
// password field, or the workspace when nothing has focus. The tabs are the
// deck's three layouts, Keys, Pad and Home; the lit one is the layout
// shown, its highlight glides between tabs, and a press picks a layout by
// hand until the focus changes.
import { createEffect, createRoot, For, on, untrack } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { chooseLayout, focusTitle, layout, type Layout } from "../focus.ts";
import { glide } from "../motion.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { STRIP_H } from "./geometry.ts";
import { pressed } from "./press.ts";

const TAB_W = 72;
const TABS_X = 512 - 4 - 3 * TAB_W;
const TITLE_W = TABS_X - 24;

interface Tab {
  layout: Layout;
  glyph: string;
  label: string;
}
const TABS: Tab[] = [
  { layout: "keys", glyph: "\u{f030c}", label: "Keys" },
  { layout: "pad", glyph: "\u{f0741}", label: "Pad" },
  { layout: "home", glyph: "\u{f02dc}", label: "Home" },
];

const tabAt = (x: number) => (x >= TABS_X && x < TABS_X + 3 * TAB_W ? Math.floor((x - TABS_X) / TAB_W) : -1);

/** The strip's target under `x`, for the pressed look. */
export function stripTarget(x: number): string | null {
  const i = tabAt(x);
  return i >= 0 ? `strip:${TABS[i]!.layout}` : null;
}

/** The strip's fingers this frame: a press on a tab picks that layout. */
export function stripTouch(frame: TouchFrame) {
  for (const c of frame.presses) {
    const i = tabAt(c.x);
    if (i >= 0) chooseLayout(TABS[i]!.layout);
  }
}

const lit = () => Math.max(0, TABS.findIndex((t) => t.layout === layout()));

let highlight: NodeMirror | undefined;
createRoot(() => createEffect(on(lit, (i) => glide(highlight, "translateX", i * TAB_W, 160), { defer: true })));

export function Strip() {
  return (
    <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: STRIP_H, bgColor: color("background") }}>
      <Text class="absolute left-[12] top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ width: TITLE_W, textColor: color("foreground") }}>
        {focusTitle()}
      </Text>
      <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: TABS_X, width: 3 * TAB_W, bgColor: color("dark_background") }} />
      <View
        class="absolute top-[3] h-[20] rounded-sm"
        style={{ insetL: TABS_X, width: TAB_W, translateX: untrack(lit) * TAB_W, bgColor: color("selection") }}
        ref={(n: NodeMirror) => (highlight = n)}
      />
      <For each={TABS}>
        {(t, i) => (
          <>
            <Text class="absolute top-[4] w-[18] text-center font-mono text-sm leading-[16]" style={{ insetL: TABS_X + i() * TAB_W + 8, textColor: color(lit() === i() ? "accent" : pressed(`strip:${t.layout}`) ? "foreground" : "dark_foreground") }}>
              {t.glyph}
            </Text>
            <Text class="absolute top-[5] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ insetL: TABS_X + i() * TAB_W + 30, width: TAB_W - 34, textColor: color(lit() === i() ? "bright_foreground" : "dark_foreground") }}>
              {t.label}
            </Text>
          </>
        )}
      </For>
    </View>
  );
}
