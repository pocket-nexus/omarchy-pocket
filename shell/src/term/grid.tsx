// The active terminal on the stage, below the bar: Pocket Term runs placed on
// a 6.4 x 14-point cell grid in the 12 px mono face. JetBrains Mono advances
// 0.6 em (7.2 points at 12 px); tracking of -0.8 points brings each glyph to
// the cell, so 80 columns fit the panel's 512 points. Default colours are the
// theme's foreground and background; a run's own colours are 0xRRGGBB.
import { For, Index, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { runColumns, type Run } from "../../../vendor/pocket-term/shared/protocol.ts";
import { TERM_COLS, TERM_ROWS } from "../../../daemon/protocol.ts";
import "../glyphs.ts";
import { color } from "../theme.ts";
import { activeSession } from "./store.ts";

export const CELL_W = 6.4;
const TRACK = CELL_W - 7.2;
export const CELL_H = 14;
export const GRID_TOP = 18;

const hex = (rgb: number) => "#" + rgb.toString(16).padStart(6, "0");

/** A run from the run-time atlas: one Text per character, each on its own
 *  columns (two for a wide character, the run's span over its length), so
 *  the face's advance never drifts off the grid. */
function WideRun(props: { run: Run }) {
  const chars = () => [...props.run[1]];
  const step = () => runColumns(props.run) / Math.max(1, chars().length);
  return (
    <>
      <Show when={props.run[3] >= 0}>
        <View
          class="absolute top-0"
          style={{ insetL: props.run[0] * CELL_W, width: runColumns(props.run) * CELL_W, height: CELL_H, bgColor: hex(props.run[3]) }}
        />
      </Show>
      <For each={chars()}>
        {(ch, i) => (
          <Text
            class="absolute top-0 font-mono text-xs"
            style={{ insetL: (props.run[0] + i() * step()) * CELL_W, lineHeight: CELL_H, fontSlot: props.run[4], textColor: props.run[2] >= 0 ? hex(props.run[2]) : color("foreground") }}
          >
            {ch}
          </Text>
        )}
      </For>
    </>
  );
}

function RunView(props: { run: Run }) {
  if (props.run[4] !== undefined) return <WideRun run={props.run} />;
  return (
    <>
      <Show when={props.run[3] >= 0}>
        <View
          class="absolute top-0"
          style={{ insetL: props.run[0] * CELL_W, width: runColumns(props.run) * CELL_W, height: CELL_H, bgColor: hex(props.run[3]) }}
        />
      </Show>
      <Text
        class="absolute top-0 font-mono text-xs"
        style={{ insetL: props.run[0] * CELL_W, lineHeight: CELL_H, tracking: TRACK, textColor: props.run[2] >= 0 ? hex(props.run[2]) : color("foreground") }}
      >
        {props.run[1]}
      </Text>
    </>
  );
}

export function TermGrid() {
  return (
    <Show when={activeSession()} keyed>
      {(s) => (
        <View class="absolute left-0 w-[512]" style={{ insetT: GRID_TOP, height: 384 - GRID_TOP, bgColor: color("background") }}>
          <Show when={s.cursor()[2] === 1}>
            <View
              class="absolute"
              style={{ insetL: s.cursor()[0] * CELL_W, insetT: s.cursor()[1] * CELL_H, width: CELL_W, height: CELL_H, bgColor: color("accent", 0.6) }}
            />
          </Show>
          <Index each={s.rows}>
            {(row, y) => (
              <View class="absolute left-0" style={{ insetT: y * CELL_H, width: TERM_COLS * CELL_W, height: CELL_H }}>
                <For each={row()()}>{(run) => <RunView run={run} />}</For>
              </View>
            )}
          </Index>
        </View>
      )}
    </Show>
  );
}

export const GRID_ROWS = TERM_ROWS;
