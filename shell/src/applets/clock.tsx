// Clock: the time and date with a stopwatch under them in the window, and a
// month calendar on the deck with buttons for the months and the stopwatch.
// The hours and minutes are seven-segment digits drawn from views, scaled to
// the window: a baked face at that size would cost the package megabytes of
// atlas.
import { createMemo, createSignal, For, Index, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { C } from "../classes.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { register } from "./applet.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => (n < 10 ? `0${n}` : String(n));

const [now, setNow] = createSignal(new Date());
/** the civil time read once per tick: each Date getter converts the time zone */
const civil = createMemo(() => {
  const d = now();
  return { hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(), day: d.getDay(), date: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
});
/** milliseconds on the stopwatch before the current run, and when it started */
const [banked, setBanked] = createSignal(0);
const [since, setSince] = createSignal<number | null>(null);
const [month, setMonth] = createSignal(0);
let ticking = 0;

function tick(token: number) {
  if (token !== ticking) return;
  setNow(new Date());
  after(since() === null ? 0.5 : 0.1, () => tick(token));
}

const elapsed = () => banked() + (since() === null ? 0 : now().getTime() - since()!);
function stopwatch() {
  const ms = elapsed();
  return `${two(Math.floor(ms / 60000))}:${two(Math.floor((ms % 60000) / 1000))}.${Math.floor((ms % 1000) / 100)}`;
}

function toggleStopwatch() {
  const start = since();
  if (start === null) setSince(Date.now());
  else {
    setBanked((b) => b + Date.now() - start);
    setSince(null);
  }
  setNow(new Date());
}

function resetStopwatch() {
  setBanked(0);
  setSince(since() === null ? null : Date.now());
  setNow(new Date());
}

/** Segments a..g (top, top right, bottom right, bottom, bottom left, top left, middle) lit per digit. */
const SEGMENTS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];
const DIGIT_W = 52;
const DIGIT_H = 96;
const T = 9;
const GAP = 14;
const COLON = 28;
const CLOCK_W = DIGIT_W * 4 + GAP * 2 + COLON;
const HALF = (DIGIT_H - T) / 2;
/** each segment's box inside its digit, at scale 1 */
const BOX: [string, number, number, number, number][] = [
  ["a", T, 0, DIGIT_W - 2 * T, T],
  ["b", DIGIT_W - T, T, T, HALF - T / 2],
  ["c", DIGIT_W - T, HALF + T, T, HALF - T / 2],
  ["d", T, DIGIT_H - T, DIGIT_W - 2 * T, T],
  ["e", 0, HALF + T, T, HALF - T / 2],
  ["f", 0, T, T, HALF - T / 2],
  ["g", T, HALF, DIGIT_W - 2 * T, T],
];
const LEFTS = [0, DIGIT_W + GAP, DIGIT_W * 2 + GAP + COLON, DIGIT_W * 3 + GAP * 2 + COLON];

function Digits(props: { text: () => string; x: number; y: number; s: number }) {
  return (
    <>
      <Index each={LEFTS}>
        {(left, i) => (
          <For each={BOX}>
            {([name, x, y, w, h]) => (
              <View
                class="absolute rounded-sm"
                style={{
                  insetL: props.x + (left() + x) * props.s,
                  insetT: props.y + y * props.s,
                  width: w * props.s,
                  height: h * props.s,
                  bgColor: SEGMENTS[Number(props.text()[i])]?.includes(name) ? color("bright_foreground") : color("selection", 0.5),
                }}
              />
            )}
          </For>
        )}
      </Index>
      <For each={[0.3, 0.65]}>
        {(at) => (
          <View
            class="absolute rounded-sm"
            style={{ insetL: props.x + (DIGIT_W * 2 + GAP + (COLON - 10) / 2) * props.s, insetT: props.y + DIGIT_H * at * props.s, width: 10 * props.s, height: 10 * props.s, bgColor: color("accent") }}
          />
        )}
      </For>
    </>
  );
}

const digits = createMemo(() => `${two(civil().hours)}${two(civil().minutes)}`);

function Stage(props: { w: number; h: number }) {
  // the digits, seconds, date and stopwatch take about 270 points at scale 1
  const s = () => Math.min(1, (props.w - 24) / CLOCK_W, (props.h - 20) / 270);
  const top = () => Math.max(6, (props.h - 270 * s()) / 2);
  const digitsL = () => (props.w - CLOCK_W * s()) / 2;
  const below = () => top() + DIGIT_H * s() + 10;
  return (
    <>
      <Digits text={digits} x={digitsL()} y={top()} s={s()} />
      <Text class="absolute left-0 text-center text-2xl leading-[28]" style={{ insetT: below(), width: props.w, textColor: color("accent") }}>{two(civil().seconds)}</Text>
      <Text class="absolute left-0 h-[20] overflow-hidden text-center text-base leading-[20]" style={{ insetT: below() + 36, width: props.w, textColor: color("foreground") }}>
        {props.w >= 300 ? `${WEEKDAYS[civil().day]}, ${civil().date} ${MONTHS[civil().month]} ${civil().year}` : `${civil().date} ${MONTHS[civil().month]!.slice(0, 3)}`}
      </Text>
      <Show when={props.h >= 230}>
        <Text class="absolute left-0 text-center text-2xl leading-[28]" style={{ insetT: below() + 72, width: props.w, textColor: color(since() === null ? "dark_foreground" : "green") }}>
          {stopwatch()}
        </Text>
      </Show>
    </>
  );
}

/** The weeks of the month `offset` months from now, Monday first. */
function weeks(offset: number) {
  const today = now();
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return { first, rows };
}

const CELL_W = 56;
const CELL_H = 32;
const GRID_L = 8;
const GRID_T = 52;
/** the deck's buttons: the month header's arrows and today, the stopwatch on the right */
const BUTTONS: { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: "prev", x: 8, y: 4, w: 40, h: 24 },
  { id: "today", x: 52, y: 4, w: 288, h: 24 },
  { id: "next", x: 344, y: 4, w: 40, h: 24 },
  { id: "stopwatch", x: 404, y: 108, w: 100, h: 64 },
  { id: "reset", x: 404, y: 180, w: 100, h: 40 },
];
const button = (id: string) => BUTTONS.find((b) => b.id === id)!;

function Button(props: { id: string; label: () => string; on?: () => boolean }) {
  const b = button(props.id);
  return (
    <View class="absolute rounded-md" style={{ insetL: b.x, insetT: b.y, width: b.w, height: b.h, bgColor: color(props.on?.() ? "accent" : "dark_background") }}>
      <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: b.h / 2 - 8, width: b.w, textColor: color(props.on?.() ? "background" : "foreground") }}>{props.label()}</Text>
    </View>
  );
}

function Deck() {
  const view = () => weeks(month());
  const isToday = (day: number | null) => month() === 0 && day === civil().date;
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Button id="prev" label={() => "\u{f0141}"} />
      <Button id="today" label={() => `${MONTHS[view().first.getMonth()]} ${view().first.getFullYear()}`} />
      <Button id="next" label={() => "\u{f0142}"} />
      <For each={["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]}>
        {(d, i) => (
          <Text class="absolute top-[34] text-center font-mono text-xs leading-[14]" style={{ insetL: GRID_L + i() * CELL_W, width: CELL_W, textColor: color(i() >= 5 ? "magenta" : "dark_foreground") }}>
            {d}
          </Text>
        )}
      </For>
      <Index each={view().rows}>
        {(week, r) => (
          <Index each={week()}>
            {(day, c) => (
              <Show when={day() !== null}>
                <View class="absolute rounded-md" style={{ insetL: GRID_L + c * CELL_W + 3, insetT: GRID_T + r * CELL_H, width: CELL_W - 6, height: CELL_H - 4, bgColor: color(isToday(day()) ? "accent" : "dark_background") }}>
                  <Text class="absolute left-0 top-[6] text-center text-base leading-[16]" style={{ width: CELL_W - 6, textColor: color(isToday(day()) ? "background" : c >= 5 ? "magenta" : "foreground") }}>
                    {String(day())}
                  </Text>
                </View>
              </Show>
            )}
          </Index>
        )}
      </Index>
      <Text class="absolute left-[404] top-[60] w-[100] text-center font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>Stopwatch</Text>
      <Text class="absolute left-[404] top-[80] w-[100] text-center font-mono text-sm leading-[16]" style={{ textColor: color(since() === null ? "foreground" : "green") }}>{stopwatch()}</Text>
      <Button id="stopwatch" label={() => (since() === null ? (elapsed() ? "Resume" : "Start") : "Stop")} on={() => since() !== null} />
      <Button id="reset" label={() => "Reset"} />
    </View>
  );
}

function act(id: string) {
  if (id === "prev") setMonth((m) => m - 1);
  else if (id === "next") setMonth((m) => m + 1);
  else if (id === "today") setMonth(0);
  else if (id === "stopwatch") toggleStopwatch();
  else if (id === "reset") resetStopwatch();
}

register({
  id: "clock",
  title: "Clock",
  icon: "\u{f0954}",
  Stage,
  Deck,
  press(key) {
    if (key & BTN.LEFT) setMonth((m) => m - 1);
    else if (key & BTN.RIGHT) setMonth((m) => m + 1);
    else if (key & BTN.CIRCLE) toggleStopwatch();
  },
  touches(frame: TouchFrame) {
    for (const tap of frame.taps) {
      const hit = BUTTONS.find((b) => tap.x >= b.x && tap.x < b.x + b.w && tap.y >= b.y && tap.y < b.y + b.h);
      if (hit) act(hit.id);
      // a sideways swipe over the calendar turns the month
      else if (tap.moved && tap.start.x < 400 && Math.abs(tap.x - tap.start.x) > 40) setMonth((m) => m + (tap.x < tap.start.x ? 1 : -1));
    }
  },
  shown() {
    tick(++ticking);
  },
  hidden() {
    ticking++;
  },
});
