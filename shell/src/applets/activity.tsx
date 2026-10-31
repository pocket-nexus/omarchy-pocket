// Activity: the system monitor. The window shows CPU load (all cores and each
// core) with a minute of history, memory, network rates, temperatures,
// uptime and load average, in two columns when it is wide and one when it
// is not; Tab turns the window to the busiest processes, by CPU or by memory
// (Left and Right), the arrows moving down the list, and Tab turns it back.
// Figures come from omarchy-pocketd (daemon/applets.ts) once a second while
// the window is on the current workspace, processes every two while they
// show.
import { batch, createMemo, createSignal, For, Index } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import type { Process, SystemStats } from "../../../daemon/protocol.ts";
import { color } from "../theme.ts";
import { register } from "./applet.ts";

const HISTORY = 60;
const PROCESSES = 24;
const [stats, setStats] = createSignal<SystemStats | null>(null);
/** the minute's samples sweep: each second writes one slot and moves the head,
 *  so one bar changes instead of all sixty shifting */
const history = Array.from({ length: HISTORY }, () => createSignal(0));
const [head, setHead] = createSignal(0);
const [procs, setProcs] = createSignal<Process[]>([]);
const [sort, setSort] = createSignal<"cpu" | "mem">("cpu");
const [selected, setSelected] = createSignal(0);
const [view, setView] = createSignal<"stats" | "processes">("stats");
let polling = 0;
let ticks = 0;

function loadProcs(token: number) {
  request<Process[]>({ method: "processes", sort: sort() }).then((p) => token === polling && setProcs(p.slice(0, PROCESSES)), () => {});
}

function poll(token: number) {
  if (token !== polling) return;
  request<SystemStats>({ method: "systemStats" }).then((s) => {
    if (token !== polling) return;
    batch(() => {
      setStats(s);
      history[head()]![1](s.cpu);
      setHead((h) => (h + 1) % HISTORY);
    });
  }, () => {});
  if (ticks++ % 2 === 0 && view() === "processes") loadProcs(token);
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

function Stats(props: { w: number; h: number }) {
  const s = stats;
  const wide = () => props.w >= 420;
  const colW = () => (wide() ? (props.w - 36) / 2 : props.w - 24);
  // positions change with the window or the core count, not with each sample
  const cores = createMemo(() => s()?.cores.length ?? 4);
  const rightX = createMemo(() => (wide() ? 24 + colW() : 12));
  const rightY = createMemo(() => (wide() ? 8 : 88 + cores() * 32));
  const right = () => ({ x: rightX(), y: rightY() });
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
        <For each={history}>
          {([value], i) => (
            <View class="absolute" style={{ insetL: i() * barW(), insetT: 2 + GRAPH_H - (GRAPH_H * value()) / 100, width: Math.max(1, barW() - 0.5), height: (GRAPH_H * value()) / 100, bgColor: load(value()) }} />
          )}
        </For>
        <View class="absolute top-0 w-[2]" style={{ insetL: head() * barW(), height: GRAPH_H + 4, bgColor: color("bright_foreground", 0.5) }} />
      </View>
      <Meter x={right().x} y={right().y + 98} w={colW()} label="memory" value={s() ? `${mib(s()!.memUsed)} / ${mib(s()!.memTotal)}` : ""} percent={mem()} />
      <Text class="absolute font-mono text-sm leading-[16]" style={{ insetL: right().x, insetT: right().y + 134, textColor: color("green") }}>{`\u{f01da} ${rate(s()?.rx ?? 0)}`}</Text>
      <Text class="absolute font-mono text-sm leading-[16]" style={{ insetL: right().x + colW() / 2, insetT: right().y + 134, textColor: color("magenta") }}>{`\u{f0552} ${rate(s()?.tx ?? 0)}`}</Text>
      <Index each={(s()?.temps ?? []).slice(0, 3)}>
        {(t, i) => (
          <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: rightX(), insetT: rightY() + 162 + i * 16, textColor: color(t().celsius >= 70 ? "red" : "foreground") }}>
            {`${t().name.replace(/[-_]thermal$/, "").slice(0, 12).padEnd(13)}${t().celsius.toFixed(1)} °C`}
          </Text>
        )}
      </Index>
      <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: right().x, insetT: right().y + 216, textColor: color("foreground") }}>
        {`up ${duration(s()?.uptime ?? 0)}   load ${s()?.load ?? ""}`}
      </Text>
    </>
  );
}

const ROW_H = 20;
const LIST_T = 30;

/** The busiest processes in the window, the selected one kept in view. */
function Processes(props: { w: number; h: number }) {
  const count = () => Math.max(1, Math.floor((props.h - LIST_T - 4) / ROW_H));
  const first = () => Math.max(0, Math.min(selected() - count() + 1, procs().length - count()));
  const narrow = () => props.w < 300;
  return (
    <>
      <Text class="absolute left-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("accent") }}>{`by ${sort() === "cpu" ? "CPU" : "memory"}`}</Text>
      <Text class="absolute right-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>{narrow() ? "CPU    MEM" : "PID      CPU       MEM"}</Text>
      <For each={procs().slice(first(), first() + count())}>
        {(p, i) => {
          const at = () => first() + i();
          return (
            <View class="absolute rounded-sm" style={{ insetL: 6, insetT: LIST_T + i() * ROW_H, width: props.w - 12, height: ROW_H, bgColor: color(at() === selected() ? "selection" : "background") }}>
              <Text class="absolute left-[6] top-[3] h-[14] overflow-hidden font-mono text-sm leading-[14]" style={{ width: narrow() ? props.w - 136 : props.w - 200, textColor: color(at() === selected() ? "bright_foreground" : "foreground") }}>
                {p.name}
              </Text>
              <Text class="absolute right-[6] top-[3] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
                {narrow() ? `${p.cpu.toFixed(1).padStart(5)}% ${mib(p.rssKb).padStart(7)}` : `${String(p.pid).padStart(6)}  ${p.cpu.toFixed(1).padStart(5)}%  ${mib(p.rssKb).padStart(8)}`}
              </Text>
            </View>
          );
        }}
      </For>
    </>
  );
}

function Stage(props: { w: number; h: number }) {
  return <>{view() === "stats" ? <Stats w={props.w} h={props.h} /> : <Processes w={props.w} h={props.h} />}</>;
}

function choose(id: "cpu" | "mem") {
  setSort(id);
  setSelected(0);
  loadProcs(polling);
}

function select(index: number) {
  setSelected(Math.max(0, Math.min(procs().length - 1, index)));
}

function toggleView() {
  setView((v) => (v === "stats" ? "processes" : "stats"));
  if (view() === "processes") loadProcs(polling);
}

register({
  id: "activity",
  title: "Activity",
  icon: "\u{f04c5}",
  Stage,
  hint: () => (view() === "stats" ? "Tab shows the processes" : "↑↓ move · ←→ by CPU or memory · Tab shows the stats"),
  press(key) {
    if (key & BTN.TRIANGLE) toggleView();
    else if (key & BTN.UP) select(selected() - 1);
    else if (key & BTN.DOWN) select(selected() + 1);
    else if (key & BTN.LEFT) choose("cpu");
    else if (key & BTN.RIGHT) choose("mem");
  },
  shown() {
    poll(++polling);
  },
  hidden() {
    polling++;
  },
});
