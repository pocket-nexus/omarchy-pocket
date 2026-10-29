// A list on the deck that moves instead of cutting. Every row is laid out
// once in a column, by position, so new items refresh rows in place; scrolling tweens the column's translate, and the
// highlight is one bar that glides to the selected row, both on the core's
// tracks (paint-only, no relayout). A finger drags the column live and it
// settles on a whole row when lifted; a tap (a contact that did not travel)
// picks the row under it. The selection, by D-pad or by tap, keeps itself in
// view.
import { createEffect, createSignal, Index, on, untrack, type JSX } from "solid-js";
import { View, type NodeMirror } from "@pocketjs/framework/components";
import { glide, place } from "../motion.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";

export interface ListState {
  /** the first row shown, a whole number between drags */
  first: () => number;
  /** keeps row `index` in view */
  reveal(index: number, count: number): void;
  /** drags scroll; a tap on a row calls `pick` with its index */
  touch(frame: TouchFrame, count: number, pick: (index: number) => void): void;
  reset(): void;
  rows: number;
  /** wired by <List>: the column's node, moved by drags */
  bind(column: NodeMirror): void;
}

export function createList(rowH: number, top: number, rows: number, initial = 0): ListState {
  const [first, setFirst] = createSignal(initial);
  let exact = initial;
  let column: NodeMirror | undefined;
  let dragging = false;
  const clampTo = (count: number, v: number) => Math.max(0, Math.min(Math.max(0, count - rows), v));
  return {
    first,
    rows,
    bind(node) {
      column = node;
    },
    reveal(index, count) {
      let next = first();
      if (index < next) next = index;
      else if (index >= next + rows) next = index - rows + 1;
      next = clampTo(count, next);
      exact = next;
      setFirst(next);
    },
    touch(frame, count, pick) {
      const bottom = top + rows * rowH;
      const finger = frame.down.find((c) => c.moved && c.start.y >= top && c.start.y < bottom);
      if (finger) {
        dragging = true;
        exact = clampTo(count, exact - finger.dy / rowH);
        place(column, "translateY", -exact * rowH);
      } else if (dragging && !frame.down.length) {
        dragging = false;
        const settled = Math.round(exact);
        exact = settled;
        // the effect glides there when the row changes; a drag back to the same row glides too
        if (settled === first()) glide(column, "translateY", -settled * rowH);
        setFirst(settled);
      }
      for (const t of frame.taps) {
        if (t.moved || t.y < top || t.y >= bottom) continue;
        const index = first() + Math.floor((t.y - top) / rowH);
        if (index < count) pick(index);
      }
    },
    reset() {
      exact = 0;
      setFirst(0);
    },
  };
}

/** The rows of `items` at `top`, `state.rows` of them in view, the selected
 *  one under the gliding bar. */
export function List<T>(props: {
  state: ListState;
  items: () => readonly T[];
  top: number;
  rowH: number;
  /** x and width of the rows and the bar */
  left?: number;
  width?: number;
  selected: () => number;
  children: (item: () => T, index: number) => JSX.Element;
}) {
  let column: NodeMirror | undefined;
  let bar: NodeMirror | undefined;
  const left = props.left ?? 8;
  const width = props.width ?? 496;
  // translates start where the state is and then only move by tween: a
  // reactive style would set them before the tween could start from there
  const startY = untrack(() => -props.state.first() * props.rowH);
  const startBar = untrack(() => props.selected() * props.rowH);
  createEffect(on(props.state.first, (first) => glide(column, "translateY", -first * props.rowH), { defer: true }));
  createEffect(on(props.selected, (i) => glide(bar, "translateY", i * props.rowH, 110), { defer: true }));
  return (
    <View class="absolute overflow-hidden contain-strict" style={{ insetL: left, insetT: props.top, width, height: props.state.rows * props.rowH }}>
      <View
        class="absolute left-0 top-0"
        style={{ width, height: Math.max(1, props.items().length) * props.rowH, translateY: startY }}
        ref={(node: NodeMirror) => {
          column = node;
          props.state.bind(node);
        }}
      >
        <View
          class="absolute left-0 top-0 rounded-sm"
          style={{ width, height: props.rowH, bgColor: color("selection"), opacity: props.selected() >= 0 && props.items().length ? 1 : 0, translateY: startBar }}
          ref={(node: NodeMirror) => (bar = node)}
        />
        <Index each={props.items()}>
          {(item, i) => (
            <View class="absolute left-0" style={{ insetT: i * props.rowH, width, height: props.rowH }}>
              {props.children(item, i)}
            </View>
          )}
        </Index>
      </View>
    </View>
  );
}
