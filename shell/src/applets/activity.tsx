// Activity: the system monitor. The window shows CPU load (all cores and each
// core) with a minute of history, memory, network rates, temperatures,
// uptime and load average, in two columns when it is wide and one when it
// is not. The deck lists the busiest processes, by CPU or by memory (the
// chips along its top); a finger drags the list. Figures come from
// omarchy-pocketd (daemon/applets.ts) once a second, processes every two,
// only while the window is on the current workspace.
import { createSignal, For, Index, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import type { Process, SystemStats } from "../../../daemon/protocol.ts";
import { C } from "../classes.ts";
import { BODY_H } from "../deck/geometry.ts";
import { createScroll } from "../deck/scroll.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { register } from "./applet.ts";

const HISTORY = 60;
const [stats, setStats] = createSignal<SystemStats | null>(null);
const [history, setHistory] = createSignal<number[]>(Array.from({ length: HISTORY }, () => 0));
const [procs, setProcs] = createSignal<Process[]>([]);
const [sort, setSort] = createSignal<"cpu" | "mem">("cpu");
const [selected, setSelected] = createSignal(0);
let polling = 0;
let ticks = 0;

function loadProcs(token: number) {
  request<Process[]>({ method: "processes", sort: sort() }).then((p) => token === polling && setProcs(p), () => {});
}

function poll(token: number) {
  if (token !== polling) return;
  request<SystemStats>({ method: "systemStats" }).then((s) => {
    if (token !== polling) return;
    setStats(s);
    setHistory((h) => [...h.slice(1), s.cpu]);
  }, () => {});
  if (ticks++ % 2 === 0) loadProcs(token);
  after(1, () => poll(token));
}

const mib = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GiB` : `${Math.round(kb / 1024)} MiB`);
const rate = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB/s` : `${(bytes / 1024).toFixed(1)} kB/s`);
function duration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const load = (percent: number) => color(percent >= 85 ? "red" : percent >= 60 ? "yellow" : "accent");

function Meter(props: { x: number; y: number; w: number; label: string; value: string; percent: number }) {
  return (
    <>
      <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: props.x, insetT: props.y, textColor: color("dark_foreground") }}>{props.label}</Text>
      <Text class="absolute text-right font-mono text-xs leading-[14]" style={{ insetL: props.x, insetT: props.y, width: props.w, textColor: color("foreground") }}>{props.value}</Text>
      <View class="absolute h-[6] rounded-sm" style={{ insetL: props.x, insetT: props.y + 17, width: props.w, bgColor: color("selection") }} />
      <View class="absolute h-[6] rounded-sm" style={{ insetL: props.x, insetT: props.y + 17, width: Math.max(2, (props.w * Math.min(100, props.percent)) / 100), bgColor: load(props.percent) }} />
    </>
  );
}

const GRAPH_H = 64;

function Stage(props: { w: number; h: number }) {
  const s = stats;
  const wide = () => props.w >= 420;
  const colW = () => (wide() ? (props.w - 36) / 2 : props.w - 24);
  const right = () => (wide() ? { x: 24 + colW(), y: 8 } : { x: 12, y: 88 + (s()?.cores.length ?? 4) * 32 });
  const mem = () => (s() ? (s()!.memUsed * 100) / Math.max(1, s()!.memTotal) : 0);
  const barW = () => colW() / HISTORY;
  return (
    <>
      <Text class="absolute left-[12] top-[8] text-sm leading-[16]" style={{ textColor: color("dark_foreground") }}>CPU</Text>
      <Text class="absolute left-[12] top-[28] text-2xl leading-[28]" style={{ textColor: load(s()?.cpu ?? 0) }}>{`${s()?.cpu ?? 0}%`}</Text>
      <Text class="absolute left-[12] top-[62] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
        {s() ? `${s()!.cores.length} cores  ${s()!.mhz} MHz` : "reading /proc..."}
      </Text>
      <Index each={s()?.cores ?? []}>
        {(core, i) => <Meter x={12} y={88 + i * 32} w={colW()} label={`core ${i}`} value={`${core()}%`} percent={core()} />}
      </Index>
      <Text class="absolute text-sm leading-[16]" style={{ insetL: right().x, insetT: right().y, textColor: color("dark_foreground") }}>Last minute</Text>
      <View class="absolute rounded-sm" style={{ insetL: right().x, insetT: right().y + 20, width: colW(), height: GRAPH_H + 4, bgColor: color("dark_background") }}>
        <Index each={history()}>
          {(value, i) => (
            <View class="absolute" style={{ insetL: i * barW(), insetT: 2 + GRAPH_H - (GRAPH_H * value()) / 100, width: Math.max(1, barW() - 0.5), height: (GRAPH_H * value()) / 100, bgColor: load(value()) }} />
          )}
        </Index>
      </View>
      <Meter x={right().x} y={right().y + 98} w={colW()} label="memory" value={s() ? `${mib(s()!.memUsed)} / ${mib(s()!.memTotal)}` : ""} percent={mem()} />
      <Text class="absolute font-mono text-sm leading-[16]" style={{ insetL: right().x, insetT: right().y + 134, textColor: color("green") }}>{`\u{f01da} ${rate(s()?.rx ?? 0)}`}</Text>
      <Text class="absolute font-mono text-sm leading-[16]" style={{ insetL: right().x + colW() / 2, insetT: right().y + 134, textColor: color("magenta") }}>{`\u{f0552} ${rate(s()?.tx ?? 0)}`}</Text>
      <For each={(s()?.temps ?? []).slice(0, 3)}>
        {(t, i) => (
          <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: right().x, insetT: right().y + 162 + i() * 16, textColor: color(t.celsius >= 70 ? "red" : "foreground") }}>
            {`${t.name.replace(/[-_]thermal$/, "").slice(0, 12).padEnd(13)}${t.celsius.toFixed(1)} °C`}
          </Text>
        )}
      </For>
      <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: right().x, insetT: right().y + 216, textColor: color("foreground") }}>
        {`up ${duration(s()?.uptime ?? 0)}   load ${s()?.load ?? ""}`}
      </Text>
    </>
  );
}

const ROW_H = 22;
const LIST_T = 34;
const list = createScroll(ROW_H, LIST_T, Math.floor((BODY_H - LIST_T - 4) / ROW_H));
const CHIPS: { id: "cpu" | "mem"; label: string; x: number }[] = [
  { id: "cpu", label: "CPU", x: 8 },
  { id: "mem", label: "Memory", x: 76 },
];

function choose(id: "cpu" | "mem") {
  setSort(id);
  setSelected(0);
  list.reset();
  loadProcs(polling);
}

function Deck() {
  const visible = () => procs().slice(list.first(), list.first() + list.rows).map((p, i) => ({ p, at: list.first() + i }));
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <For each={CHIPS}>
        {(chip) => (
          <View class="absolute top-[5] h-[22] w-[62] rounded-sm" style={{ insetL: chip.x, bgColor: color(sort() === chip.id ? "accent" : "dark_background") }}>
            <Text class="absolute left-0 top-[4] w-[62] text-center font-mono text-xs leading-[14]" style={{ textColor: color(sort() === chip.id ? "background" : "foreground") }}>{chip.label}</Text>
          </View>
        )}
      </For>
      <Text class="absolute right-[12] top-[10] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>PID      CPU       MEM</Text>
      <For each={visible()}>
        {(item, i) => (
          <View class={C.row} style={{ insetT: LIST_T + i() * ROW_H }}>
            <Show when={item.at === selected()}>
              <View class={C.rowOn} style={{ bgColor: color("selection") }} />
            </Show>
            <Text class="absolute left-[8] top-[4] w-[230] h-[14] overflow-hidden font-mono text-sm leading-[14]" style={{ textColor: color(item.at === selected() ? "bright_foreground" : "foreground") }}>
              {item.p.name}
            </Text>
            <Text class="absolute right-[8] top-[4] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
              {`${String(item.p.pid).padStart(6)}  ${item.p.cpu.toFixed(1).padStart(5)}%  ${mib(item.p.rssKb).padStart(8)}`}
            </Text>
          </View>
        )}
      </For>
    </View>
  );
}

function select(index: number) {
  const next = Math.max(0, Math.min(procs().length - 1, index));
  setSelected(next);
  list.reveal(next, procs().length);
}

register({
  id: "activity",
  title: "Activity",
  icon: "\u{f04c5}",
  Stage,
  Deck,
  press(key) {
    if (key & BTN.UP) select(selected() - 1);
    else if (key & BTN.DOWN) select(selected() + 1);
  },
  touches(frame: TouchFrame) {
    for (const tap of frame.taps) {
      if (tap.moved || tap.y >= LIST_T) continue;
      const chip = CHIPS.find((c) => tap.x >= c.x && tap.x < c.x + 62);
      if (chip) choose(chip.id);
    }
    list.touch(frame, procs().length, setSelected);
  },
  shown() {
    poll(++polling);
  },
  hidden() {
    polling++;
  },
});
