// The chord loop on the landing page: what is held at each tick of the
// recording (site/record.ts plays it into the real shell; the page plays the
// video and moves the model's buttons from the same table). 60 ticks a second.
export const LENGTH = 400;
export const ROWS = { L1: "focus", R1: "swap" };
export const CHORDS = [
  { shoulder: "L1", from: 40, to: 170, taps: [[72, "RIGHT"], [122, "LEFT"]] },
  { shoulder: "R1", from: 210, to: 350, taps: [[242, "RIGHT"], [298, "LEFT"]] },
];
const TAP = 7;

/** What the gamepad is doing at `tick`. */
export function held(tick) {
  for (const c of CHORDS) {
    if (tick < c.from || tick >= c.to) continue;
    const tap = c.taps.find(([at]) => tick >= at && tick < at + TAP);
    return { shoulder: c.shoulder, direction: tap?.[1] ?? null, last: [...c.taps].reverse().find(([at]) => tick >= at)?.[1] ?? null };
  }
  return { shoulder: null, direction: null, last: null };
}
