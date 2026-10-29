// A list on the deck that a finger drags: rows of ROW_H from `top`, the
// first one shown following the drag, and a tap (a contact that did not
// travel) on a row picks it.
import { createSignal } from "solid-js";
import type { TouchFrame } from "../touch.ts";

export function createScroll(rowH: number, top: number, rows: number) {
  const [first, setFirst] = createSignal(0);
  let exact = 0;
  const clampTo = (count: number, v: number) => Math.max(0, Math.min(Math.max(0, count - rows), v));
  return {
    first,
    rows,
    /** keeps row `index` on the deck */
    reveal(index: number, count: number) {
      if (index < first()) exact = index;
      else if (index >= first() + rows) exact = index - rows + 1;
      else return;
      setFirst(clampTo(count, Math.round(exact)));
    },
    /** drags scroll; a tap on a row calls `pick` with its index */
    touch(frame: TouchFrame, count: number, pick: (index: number) => void) {
      const bottom = top + rows * rowH;
      for (const c of frame.down) {
        if (!c.moved || c.start.y < top || c.start.y >= bottom) continue;
        exact = clampTo(count, exact - c.dy / rowH);
        setFirst(Math.round(exact));
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
