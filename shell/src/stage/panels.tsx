// The panels Omarchy opens from the bar's indicators (plugins/panels:
// Bluetooth, Network, Audio, Power) on the deck's body: a tap on the
// indicator in the deck's strip, or `omarchy-shell shell summon
// omarchy.network|...`; the bar marks the open one. Up/Down move between
// rows, A acts, Left/Right adjust a slider, Y forgets a saved network, B
// closes the panel. The highlight follows a row, not a position: rows keep their
// first order while the panel is open, though rescans re-sort them. A secured
// network asks for its password on the touch keyboard. Data comes from
// omarchy-pocketd (daemon/panels.ts), again every few seconds while a panel
// is open.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import type { AudioDevice, AudioPanel, BluetoothPanel, NetworkPanel, PowerPanel, ProxyPanel } from "../../../daemon/protocol.ts";
import { C } from "../classes.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { isAddressLike } from "../generated/bluetooth-model.js";
import { wifiIconFor } from "../generated/network-model.js";
import { profileIcon } from "../generated/power-model.js";
import { batteryGlyph } from "../indicators.ts";
import { toast } from "./toasts.tsx";
import { state } from "../system.ts";
import { setKeySink } from "../term/keyboard.tsx";
import { color } from "../theme.ts";
import { CARD_H, CARD_W } from "./geometry.ts";
import { createList, List } from "../deck/list.tsx";
import type { TouchFrame } from "../touch.ts";

export type PanelName = "proxy" | "bluetooth" | "network" | "audio" | "power";
export const PANELS: PanelName[] = ["proxy", "bluetooth", "network", "audio", "power"];
const TITLES: Record<PanelName, string> = { proxy: "Proxy", bluetooth: "Bluetooth", network: "Network", audio: "Audio", power: "Power" };
const PROXY_MODES = ["rule", "global", "direct"];
/** a node's name as the card draws it: flags (regional indicators) have no glyph */
const nodeName = (name: string) => name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();

interface Row {
  icon: string;
  label: string;
  value?: string;
  /** a row that only shows something */
  info?: boolean;
  checked?: boolean;
  activate?(): void;
  adjust?(delta: number): void;
  forget?(): void;
}

const HEADER_H = 26;
const ROW_H = 22;
const ROWS = Math.floor((CARD_H - HEADER_H - 4) / ROW_H);
const REFRESH_EVERY = 4;
const ERROR = "\u{f015a}";
const CHECK = "\u{f012c}";
const LOCK = "\u{f033e}";

const [panel, setPanel] = createSignal<PanelName | null>(null);
/** the highlighted row, by its label: rows come and go and reorder as the
 *  daemon reports, and the highlight stays on the same row */
const [selected, setSelected] = createSignal("");
/** while a panel stays open, rows keep the order they first appeared in */
let seen = new Map<string, number>();
const [network, setNetwork] = createSignal<NetworkPanel | null>(null);
const [audio, setAudio] = createSignal<AudioPanel | null>(null);
const [power, setPower] = createSignal<PowerPanel | null>(null);
const [proxy, setProxy] = createSignal<ProxyPanel | null>(null);
const [bluetooth, setBluetooth] = createSignal<BluetoothPanel | null>(null);
/** the SSID whose password the keyboard is taking */
const [entry, setEntry] = createSignal<{ ssid: string; text: string } | null>(null);
const [busy, setBusy] = createSignal("");
let refreshing = 0;

export { panel as openPanel };
export const passwordEntry = () => entry() !== null;

const fail = (title: string) => (error: unknown) => toast({ icon: ERROR, title, body: String(error).replace(/^Error: /, ""), tone: "error" });

function load(name: PanelName, rescan = false) {
  if (name === "bluetooth") request<BluetoothPanel>({ method: "bluetooth" }).then(setBluetooth, fail("Bluetooth"));
  else if (name === "network") request<NetworkPanel>({ method: "network", rescan }).then(setNetwork, fail("Network"));
  else if (name === "audio") request<AudioPanel>({ method: "audio" }).then(setAudio, fail("Audio"));
  else if (name === "power") request<PowerPanel>({ method: "power" }).then(setPower, fail("Power"));
  else if (name === "proxy") request<ProxyPanel>({ method: "proxy" }).then(setProxy, fail("Proxy"));
}

function poll(token: number) {
  after(REFRESH_EVERY, () => {
    const name = panel();
    if (token !== refreshing || !name) return;
    if (!entry() && !busy()) load(name);
    poll(token);
  });
}

export function showPanel(name: PanelName) {
  setPanel(name);
  setSelected("");
  seen = new Map();
  list.reset();
  load(name, name === "network");
  poll(++refreshing);
}

export function closePanel() {
  setPanel(null);
  refreshing++;
}

/** Runs a change, shows `label` while it runs, then reloads the panel. */
function change(label: string, work: Promise<unknown>, title: string) {
  setBusy(label);
  work.then(
    () => {
      setBusy("");
      const name = panel();
      if (name) load(name);
    },
    (error) => {
      setBusy("");
      fail(title)(error);
    },
  );
}

function connect(ssid: string, password?: string) {
  change(`Connecting to ${ssid}`, request({ method: "wifiConnect", ssid, password }), ssid);
}

function askPassword(ssid: string) {
  setEntry({ ssid, text: "" });
  setKeySink({
    text: (ch) => setEntry((e) => e && { ...e, text: e.text + ch }),
    key: (name) => {
      const e = entry();
      if (!e) return;
      if (name === "Backspace") setEntry({ ...e, text: [...e.text].slice(0, -1).join("") });
      else if (name === "Enter") {
        endEntry();
        connect(e.ssid, e.text);
      } else if (name === "Escape") endEntry();
    },
    field: () => {
      const e = entry();
      return e ? `${LOCK} ${e.ssid}: ${"•".repeat([...e.text].length)}_` : "";
    },
  });
}

function endEntry() {
  setEntry(null);
  setKeySink(null);
}

function deviceRows(kind: "sink" | "source", list: AudioDevice[], title: string, icon: string): Row[] {
  const current = list.find((d) => d.current);
  const rows: Row[] = [];
  if (current) {
    rows.push({
      icon,
      label: title,
      value: current.muted ? "Muted" : `${current.volume}%`,
      activate: () => change("", request({ method: "audioSet", kind, name: current.name, muted: !current.muted }), title),
      adjust: (delta) => change("", request({ method: "audioSet", kind, name: current.name, volume: current.volume + delta * 5 }), title),
    });
  }
  for (const d of list) {
    rows.push({
      icon: "",
      label: d.label,
      checked: d.current,
      activate: () => change("", request({ method: "audioSet", kind, name: d.name, current: true }), title),
    });
  }
  return rows;
}

const rawRows = createMemo((): Row[] => {
  switch (panel()) {
    case "bluetooth": {
      const b = bluetooth();
      if (!b) return [{ icon: "", label: "Reading Bluetooth...", info: true }];
      if (!b.adapter) return [{ icon: "\u{f00b2}", label: "No Bluetooth adapter", info: true }];
      const list: Row[] = [
        {
          icon: b.powered ? "\u{f00af}" : "\u{f00b2}",
          label: "Bluetooth",
          value: b.powered ? "On" : "Off",
          activate: () => change("", request({ method: "bluetoothPower", on: !b.powered }), "Bluetooth"),
        },
      ];
      if (!b.powered) return list;
      list.push({
        icon: "\u{f0450}",
        label: "Scan",
        activate: () => change("Scanning for 8 s", request<BluetoothPanel>({ method: "bluetooth", scan: true }).then(setBluetooth), "Bluetooth"),
      });
      // as Omarchy's panel does: a device that only reports its address is noise unless it is paired
      for (const d of b.devices.filter((d) => d.paired || d.connected || !isAddressLike(d.name))) {
        list.push({
          icon: d.connected ? "\u{f00b1}" : "\u{f00af}",
          label: d.name,
          value: d.connected ? "Connected" : d.paired ? "Paired" : "",
          activate: () =>
            d.connected
              ? change("", request({ method: "bluetoothDisconnect", mac: d.mac }), d.name)
              : change(`Connecting to ${d.name}`, request({ method: "bluetoothConnect", mac: d.mac }), d.name),
          forget: d.paired ? () => change("", request({ method: "bluetoothForget", mac: d.mac }), d.name) : undefined,
        });
      }
      return list;
    }
    case "network": {
      const n = network();
      if (!n) return [{ icon: "", label: "Reading networks...", info: true }];
      const list: Row[] = [
        {
          icon: n.enabled ? "\u{f05a9}" : "\u{f05aa}",
          label: "Wi-Fi",
          value: n.enabled ? "On" : "Off",
          activate: () => change("", request({ method: "wifiPower", on: !n.enabled }), "Wi-Fi"),
        },
      ];
      const active = n.networks.find((w) => w.active);
      if (active) {
        list.push({ icon: "", label: `Disconnect ${active.ssid}`, value: n.address, activate: () => change("", request({ method: "wifiDisconnect" }), "Wi-Fi") });
      }
      if (n.enabled) list.push({ icon: "\u{f0450}", label: "Scan", activate: () => request<NetworkPanel>({ method: "network", rescan: true }).then(setNetwork, fail("Network")) });
      for (const w of n.networks) {
        list.push({
          icon: wifiIconFor(w.signal),
          label: w.secure ? `${w.ssid} ${LOCK}` : w.ssid,
          value: w.active ? "Connected" : w.known ? "Saved" : `${w.signal}%`,
          checked: w.active,
          activate: () => (w.active ? undefined : w.secure && !w.known ? askPassword(w.ssid) : connect(w.ssid)),
          forget: w.known ? () => change("", request({ method: "wifiForget", ssid: w.ssid }), w.ssid) : undefined,
        });
      }
      return list;
    }
    case "audio": {
      const a = audio();
      if (!a) return [{ icon: "", label: "Reading audio devices...", info: true }];
      return [...deviceRows("sink", a.outputs, "Output", "\u{f057e}"), ...deviceRows("source", a.inputs, "Input", "\u{f036c}")];
    }
    case "power": {
      const p = power();
      const battery = state()?.battery;
      const list: Row[] = [
        {
          icon: batteryGlyph(battery ?? null),
          label: "Battery",
          value: battery ? `${battery.percent}%${battery.charging ? " charging" : ""}` : "none",
          info: true,
        },
      ];
      if (!p) return list;
      if (p.brightness !== null) {
        const level = p.brightness;
        list.push({
          icon: "\u{f00df}",
          label: "Brightness",
          value: `${level}%`,
          adjust: (delta) => change("", request({ method: "powerSet", brightness: level + delta * 5 }), "Brightness"),
        });
      }
      for (const profile of p.profiles) {
        list.push({
          icon: profileIcon(profile),
          label: profile,
          checked: profile === p.profile,
          activate: () => change("", request({ method: "powerSet", profile }), "Power profile"),
        });
      }
      return list;
    }
    case "proxy": {
      const p = proxy();
      if (!p) return [{ icon: "", label: "Asking mihomo...", info: true }];
      if (!p.installed) return [{ icon: ERROR, label: "mihomo is not installed", info: true }];
      const list: Row[] = [
        {
          icon: "\u{f0582}",
          label: "Proxy",
          value: p.running ? "On" : "Off",
          checked: p.running,
          activate: () => change(p.running ? "Stopping mihomo" : "Starting mihomo", request({ method: "proxySet", running: !p.running }), "Proxy"),
        },
      ];
      if (!p.running) return list;
      const at = Math.max(0, PROXY_MODES.indexOf(p.mode));
      const mode = (delta: number) => change("", request({ method: "proxySet", mode: PROXY_MODES[(at + delta + PROXY_MODES.length) % PROXY_MODES.length] }), "Proxy mode");
      list.push({ icon: "\u{f01e7}", label: "Mode", value: p.mode.charAt(0).toUpperCase() + p.mode.slice(1), activate: () => mode(1), adjust: mode });
      for (const g of p.groups) {
        const i = Math.max(0, g.all.indexOf(g.now));
        list.push({
          icon: "\u{f0b8a}",
          label: nodeName(g.name),
          // A tests the group's nodes; left and right pick the previous or next one
          value: `${nodeName(g.now)}${g.delay ? ` ${g.delay} ms` : ""}`,
          activate: () => change(`Testing ${nodeName(g.name)}`, request({ method: "proxySet", test: g.name }), g.name),
          adjust: (delta) => change("", request({ method: "proxySet", group: g.name, node: g.all[(i + delta + g.all.length) % g.all.length] }), g.name),
        });
      }
      return list;
    }
    default:
      return [];
  }
});

const rows = createMemo((): Row[] => {
  const list = rawRows();
  for (const row of list) if (!seen.has(row.label)) seen.set(row.label, seen.size);
  return [...list].sort((a, b) => seen.get(a.label)! - seen.get(b.label)!);
});

const index = () => Math.max(0, rows().findIndex((row) => row.label === selected()));

const list = createList(ROW_H, HEADER_H, ROWS);

function setIndex(at: number) {
  const all = rows();
  const i = Math.max(0, Math.min(all.length - 1, at));
  const row = all[i];
  if (!row) return;
  setSelected(row.label);
  list.reveal(i, all.length);
}

function move(delta: number) {
  setIndex(index() + delta);
}

export function panelPress(key: number) {
  const row = rows()[Math.min(index(), rows().length - 1)];
  if (key & BTN.UP) move(-1);
  else if (key & BTN.DOWN) move(1);
  else if (key & BTN.LEFT) row?.adjust?.(-1);
  else if (key & BTN.RIGHT) row?.adjust?.(1);
  else if (key & BTN.CIRCLE) row?.activate?.();
  else if (key & BTN.SQUARE) row?.forget?.();
  else if (key & BTN.CROSS) closePanel();
}

/** Fingers on the panel (card coordinates; the touchpad's clicks): a tap on
 *  the header closes it, a tap selects a row and a tap on the selected row
 *  acts, a drag scrolls. */
export function panelTouch(frame: TouchFrame) {
  for (const tap of frame.taps) if (!tap.moved && tap.y < HEADER_H) return closePanel();
  list.touch(frame, rows().length, (at) => {
    if (at === index()) rows()[at]?.activate?.();
    else setIndex(at);
  });
}

/** The panel's title and position, for the deck's remote. */
export const panelPosition = () => ({ title: TITLES[panel() ?? "network"], at: index(), count: rows().length });

export function Panels() {
  return (
    <View class={C.card} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{TITLES[panel() ?? "network"]}</Text>
      <Text class="absolute right-[12] top-[6] font-mono text-xs leading-[16]" style={{ textColor: color(busy() ? "accent" : "dark_foreground") }}>
        {busy()}
      </Text>
      <View class={C.cardRule} style={{ bgColor: color("muted") }} />
      <List state={list} items={rows} top={HEADER_H} rowH={ROW_H} width={CARD_W - 16} selected={index}>
        {(row, at) => (
          <>
            <Text class={C.icon} style={{ textColor: color(at === index() ? "accent" : "dark_foreground") }}>{row().icon}</Text>
            <Text class={C.label} style={{ textColor: color(row().info ? "dark_foreground" : at === index() ? "bright_foreground" : "foreground"), ...cjk(row().label, CJK_SLOT_14) }}>
              {row().label}
            </Text>
            <Show when={row().value !== undefined || row().checked}>
              <Text class={C.chevron} style={{ textColor: color(row().checked ? "accent" : "foreground"), ...cjk(row().value ?? "", CJK_SLOT_14) }}>
                {row().checked && row().value === undefined ? CHECK : (row().value ?? "")}
              </Text>
            </Show>
          </>
        )}
      </List>
    </View>
  );
}
