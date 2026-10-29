// The deck's body while a chord layer is in force (a shoulder held, or a pill
// latched): the layer's rows of chords.ts on the right, each a tap target,
// and on the left a live map of the stage's windows at MAP_SCALE. On the map
// a tap focuses a window, a drag from one window onto another swaps them,
// and a drag onto a workspace tab in the strip moves the window there.
import { createMemo, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { perform } from "../actions.ts";
import { BUTTON_NAME, chordsOf, LABEL, LAYER_TITLE, type Layer } from "../chords.ts";
import { C } from "../classes.ts";
import { sessionById } from "../term/store.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { STAGE_H, STAGE_W } from "../wm.ts";
import { act, focused, placements, windowAt, windowById, type Win } from "../workspaces.ts";
import { layer, releasePills } from "./layer.ts";
import { tabAt } from "./strip.tsx";

const MAP_SCALE = 0.42;
const MAP_L = 8;
const MAP_T = 30;
const MAP_W = STAGE_W * MAP_SCALE;
const MAP_H = STAGE_H * MAP_SCALE;
const ROWS_L = MAP_L + MAP_W + 14;
const ROW_T = 30;
const ROW_H = 22;

const title = (w: Win) => (w.kind === "terminal" ? sessionById(w.sid)?.title() || "Terminal" : (appletOf(w)?.title ?? w.applet));
const icon = (w: Win) => (w.kind === "terminal" ? "\u{f018d}" : (appletOf(w)?.icon ?? ""));

/** A body point on the map, in stage points; null off the map. */
function onMap(x: number, y: number) {
  if (x < MAP_L || x >= MAP_L + MAP_W || y < MAP_T || y >= MAP_T + MAP_H) return null;
  return { x: (x - MAP_L) / MAP_SCALE, y: (y - MAP_T) / MAP_SCALE };
}

const winAt = (x: number, y: number) => {
  const p = onMap(x, y);
  return p ? windowAt(p.x, p.y) : null;
};

function run(l: Layer, index: number) {
  const chord = chordsOf(l)[index];
  if (!chord) return;
  releasePills();
  perform(chord.action);
}

/** The body's fingers, in body coordinates (the strip is above y = 0). */
export function chordMapTouch(frame: TouchFrame) {
  for (const tap of frame.taps) {
    const sx = tap.start.x;
    const sy = tap.start.y;
    const ex = tap.x;
    const ey = tap.y;
    const from = winAt(sx, sy);
    if (from !== null) {
      if (ey < 0) {
        const ws = tabAt(ex);
        if (ws >= 0) act((m) => m.moveToWs(from, ws));
        continue;
      }
      const to = winAt(ex, ey);
      if (to !== null && to !== from) act((m) => m.swap(from, to));
      else act((m) => m.focusWin(from));
      continue;
    }
    if (sx >= ROWS_L && sy >= ROW_T) run(layer(), Math.floor((sy - ROW_T) / ROW_H));
  }
}

export function ChordMap() {
  const rows = createMemo(() => chordsOf(layer()));
  const frames = () =>
    placements()
      .filter((p) => !p.hidden)
      .map((p) => ({ p, win: windowById(p.id)! }));
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{LAYER_TITLE[layer()]}</Text>
      <Text class="absolute right-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>press a button, or tap a row</Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <View class="absolute rounded-sm overflow-hidden" style={{ insetL: MAP_L, insetT: MAP_T, width: MAP_W, height: MAP_H, bgColor: color("dark_background") }}>
        <For each={frames()}>
          {(f) => (
            <View
              class="absolute overflow-hidden"
              style={{
                insetL: f.p.rect.x * MAP_SCALE,
                insetT: f.p.rect.y * MAP_SCALE,
                width: f.p.rect.w * MAP_SCALE,
                height: f.p.rect.h * MAP_SCALE,
                bgColor: color(focused()?.id === f.p.id ? "accent" : "muted"),
              }}
            >
              <View class="absolute left-[1] top-[1] overflow-hidden" style={{ width: f.p.rect.w * MAP_SCALE - 2, height: f.p.rect.h * MAP_SCALE - 2, bgColor: color("background") }}>
                <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: (f.p.rect.h * MAP_SCALE) / 2 - 18, width: f.p.rect.w * MAP_SCALE - 2, textColor: color("accent") }}>
                  {icon(f.win)}
                </Text>
                <Text class="absolute left-0 h-[12] overflow-hidden text-center font-mono text-xs leading-[12]" style={{ insetT: (f.p.rect.h * MAP_SCALE) / 2 + 2, width: f.p.rect.w * MAP_SCALE - 2, textColor: color("foreground") }}>
                  {title(f.win)}
                </Text>
              </View>
            </View>
          )}
        </For>
        <Show when={frames().length === 0}>
          <Text class="absolute left-0 top-[72] w-[215] text-center font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>no windows here</Text>
        </Show>
      </View>
      <Text class="absolute left-[8] w-[215] font-mono text-xs leading-[14]" style={{ insetT: MAP_T + MAP_H + 6, textColor: color("dark_foreground") }}>tap: focus</Text>
      <Text class="absolute left-[8] w-[215] font-mono text-xs leading-[14]" style={{ insetT: MAP_T + MAP_H + 22, textColor: color("dark_foreground") }}>drag onto a window: swap</Text>
      <Text class="absolute left-[8] w-[215] font-mono text-xs leading-[14]" style={{ insetT: MAP_T + MAP_H + 38, textColor: color("dark_foreground") }}>drag onto 1-5 above: move</Text>
      <For each={rows()}>
        {(chord, i) => (
          <View class="absolute rounded-sm" style={{ insetL: ROWS_L, insetT: ROW_T + i() * ROW_H, width: 504 - ROWS_L, height: ROW_H - 2, bgColor: color(i() % 2 ? "darker_background" : "dark_background") }}>
            <Text class="absolute left-[6] top-[3] w-[48] font-mono text-xs leading-[14]" style={{ textColor: color("accent") }}>{BUTTON_NAME[chord.button] ?? "?"}</Text>
            <Text class="absolute left-[56] top-[3] w-[210] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ textColor: color("bright_foreground") }}>{LABEL[chord.action]}</Text>
          </View>
        )}
      </For>
    </View>
  );
}
