// Clock: the time and date with a stopwatch under them, and a month
// calendar in the window when it is tall enough for both, or in place of
// the clock on Tab. Left and Right turn the month, Backspace comes back to
// this month, Enter starts and stops the stopwatch, Y resets it. The hours
// and minutes are seven-segment digits drawn from views, scaled to the
// window: a baked face at that size would cost the package megabytes of
// atlas.
import { createMemo, createSignal, For, Index, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { color } from "../theme.ts";
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
const [view, setView] = createSignal<"clock" | "calendar">("clock");
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

/** The digits, seconds, date and stopwatch take about 270 points at scale 1. */
const CLOCK_H = 270;

function ClockFace(props: { w: number; h: number; y: number }) {
  const s = () => Math.min(1, (props.w - 24) / CLOCK_W, (props.h - 20) / CLOCK_H);
  const top = () => props.y + Math.max(6, (props.h - CLOCK_H * s()) / 2);
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

/** The month at `y`, laid out in `w` points: six rows of CELL_H under a header. */
const CELL_H = 26;
const CAL_H = 22 + 16 + 6 * CELL_H;

function Calendar(props: { w: number; y: number }) {
  const view = () => weeks(month());
  const cellW = () => Math.min(56, (props.w - 16) / 7);
  const gridL = () => (props.w - cellW() * 7) / 2;
  const isToday = (day: number | null) => month() === 0 && day === civil().date;
  return (
    <>
      <Text class="absolute left-0 h-[16] text-center font-mono text-sm leading-[16]" style={{ insetT: props.y, width: props.w, textColor: color("accent") }}>
        {`\u{f0141}  ${MONTHS[view().first.getMonth()]} ${view().first.getFullYear()}  \u{f0142}`}
      </Text>
      <For each={["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]}>
        {(d, i) => (
          <Text class="absolute text-center font-mono text-xs leading-[14]" style={{ insetL: gridL() + i() * cellW(), insetT: props.y + 22, width: cellW(), textColor: color(i() >= 5 ? "magenta" : "dark_foreground") }}>
            {d}
          </Text>
        )}
      </For>
      <Index each={view().rows}>
        {(week, r) => (
          <Index each={week()}>
            {(day, c) => (
              <Show when={day() !== null}>
                <View class="absolute rounded-sm" style={{ insetL: gridL() + c * cellW() + 2, insetT: props.y + 38 + r * CELL_H, width: cellW() - 4, height: CELL_H - 3, bgColor: color(isToday(day()) ? "accent" : "dark_background") }}>
                  <Text class="absolute left-0 top-[4] text-center font-mono text-sm leading-[16]" style={{ width: cellW() - 4, textColor: color(isToday(day()) ? "background" : c >= 5 ? "magenta" : "foreground") }}>
                    {String(day())}
                  </Text>
                </View>
              </Show>
            )}
          </Index>
        )}
      </Index>
    </>
  );
}

function Stage(props: { w: number; h: number }) {
  // both fit one over the other when the window is tall; else Tab turns the page
  const both = () => props.h >= 190 + CAL_H;
  return (
    <>
      <Show when={both() || view() === "clock"}>
        <ClockFace w={props.w} h={both() ? props.h - CAL_H : props.h} y={0} />
      </Show>
      <Show when={both() || view() === "calendar"}>
        <Calendar w={props.w} y={both() ? props.h - CAL_H : Math.max(6, (props.h - CAL_H) / 2)} />
      </Show>
    </>
  );
}

register({
  id: "clock",
  title: "Clock",
  icon: "\u{f0954}",
  Stage,
  hint: () => "←→ turn the month · B this month · Enter stopwatch · Y resets · Tab turns the page",
  press(key) {
    if (key & BTN.LEFT) setMonth((m) => m - 1);
    else if (key & BTN.RIGHT) setMonth((m) => m + 1);
    else if (key & BTN.CROSS) setMonth(0);
    else if (key & BTN.CIRCLE) toggleStopwatch();
    else if (key & BTN.SQUARE) resetStopwatch();
    else if (key & BTN.TRIANGLE) setView((v) => (v === "clock" ? "calendar" : "clock"));
  },
  shown() {
    tick(++ticking);
  },
  hidden() {
    ticking++;
  },
});
