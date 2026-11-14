import { expect, test } from "bun:test";
import { fitLines } from "../src/deck/hint.ts";

const CLOCK = "↔ turn the month · B this month · Enter stopwatch · Y resets · Tab turns the page";
const ADVANCE = 7.2;

test("a hint that fits stays on one line", () => {
  expect(fitLines("tap to click · two fingers scroll or pinch", 388)).toEqual(["tap to click · two fingers scroll or pinch"]);
});

test("a long hint breaks at its separators into lines that fit the pad", () => {
  // the Duo Lite's pad less its margins, then the Thor's
  for (const width of [302 - 24, 289 - 24]) {
    const lines = fitLines(CLOCK, width);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(" · ")).toBe(CLOCK);
    for (const line of lines) expect(line.length * ADVANCE).toBeLessThanOrEqual(width);
  }
});

test("past three lines the rest joins the last", () => {
  const lines = fitLines("aaaaaaaaaa · bbbbbbbbbb · cccccccccc · dddddddddd", 80);
  expect(lines).toEqual(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc · dddddddddd"]);
});

test("two lines break at the separator nearest the middle, as before", () => {
  expect(fitLines("tap to click · two fingers scroll or pinch", 265)).toEqual(["tap to click", "two fingers scroll or pinch"]);
  expect(fitLines("aaaa · bbbb · cccc · dddd", 100)).toEqual(["aaaa · bbbb", "cccc · dddd"]);
});
