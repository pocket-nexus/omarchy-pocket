// The panels Omarchy opens from the bar's indicators (plugins/panels: Bluetooth,
// Network, Audio, Power), on the deck. R2 opens them at Network, or
// `omarchy-shell shell summon omarchy.network|...` at that panel; L1/R1 move
// between them in the bar's order and the bar marks the open one. Up/Down
// move between rows, A acts, Left/Right adjust a slider, Y forgets a saved
// network, B closes. A secured network asks for its password on the touch
// keyboard. Data comes from omarchy-pocketd (daemon/panels.ts), again every
// few seconds while a panel is open.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import type { AudioDevice, AudioPanel, BluetoothPanel, NetworkPanel, PowerPanel } from "../../../daemon/protocol.ts";
import { C } from "../classes.ts";
import { isAddressLike } from "../generated/bluetooth-model.js";
import { wifiIconFor } from "../generated/network-model.js";
import { profileIcon } from "../generated/power-model.js";
import { batteryGlyph } from "../indicators.ts";
import { toast } from "../stage/toasts.tsx";
import { state } from "../system.ts";
import { setKeySink } from "../term/keyboard.tsx";
import { color } from "../theme.ts";

export type PanelName = "bluetooth" | "network" | "audio" | "power";
export const PANELS: PanelName[] = ["bluetooth", "network", "audio", "power"];
const TITLES: Record<PanelName, string> = { bluetooth: "Bluetooth", network: "Network", audio: "Audio", power: "Power" };

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
const ROWS = Math.floor((384 - HEADER_H - 20) / ROW_H);
const REFRESH_EVERY = 4;
const ERROR = "\u{f015a}";
const CHECK = "\u{f012c}";
const LOCK = "\u{f033e}";

const [panel, setPanel] = createSignal<PanelName | null>(null);
const [index, setIndex] = createSignal(0);
const [network, setNetwork] = createSignal<NetworkPanel | null>(null);
const [audio, setAudio] = createSignal<AudioPanel | null>(null);
const [power, setPower] = createSignal<PowerPanel | null>(null);
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
  setIndex(0);
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

const rows = createMemo((): Row[] => {
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
    default:
      return [];
  }
});

function move(delta: number) {
  setIndex((i) => Math.max(0, Math.min(rows().length - 1, i + delta)));
}

function cycle(delta: number) {
  const at = PANELS.indexOf(panel() ?? "network");
  showPanel(PANELS[(at + delta + PANELS.length) % PANELS.length]!);
}

export function panelPress(key: number) {
  const row = rows()[Math.min(index(), rows().length - 1)];
  if (key & BTN.UP) move(-1);
  else if (key & BTN.DOWN) move(1);
  else if (key & BTN.LEFT) row?.adjust?.(-1);
  else if (key & BTN.RIGHT) row?.adjust?.(1);
  else if (key & BTN.LTRIGGER) cycle(-1);
  else if (key & BTN.RTRIGGER) cycle(1);
  else if (key & BTN.CIRCLE) row?.activate?.();
  else if (key & BTN.SQUARE) row?.forget?.();
  else if (key & (BTN.CROSS | BTN.ZR)) closePanel();
}

export function panelTap(x: number, y: number) {
  if (y < HEADER_H) {
    const at = Math.floor(x / 128);
    if (PANELS[at]) showPanel(PANELS[at]!);
    return;
  }
  const at = scroll() + Math.floor((y - HEADER_H) / ROW_H);
  const row = rows()[at];
  if (!row) return;
  if (at === index()) row.activate?.();
  else setIndex(at);
}

/** the first visible row: enough to keep the highlighted one on the deck */
const scroll = () => Math.max(0, index() - ROWS + 1);

export function Panels() {
  const visible = createMemo(() => rows().slice(scroll(), scroll() + ROWS).map((row, i) => ({ row, at: scroll() + i })));
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <For each={PANELS}>
        {(name, i) => (
          <Text class="absolute top-[6] w-[128] text-center font-mono text-sm leading-[16]" style={{ insetL: i() * 128, textColor: color(name === panel() ? "accent" : "dark_foreground") }}>
            {TITLES[name]}
          </Text>
        )}
      </For>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <For each={visible()}>
        {(item, i) => (
          <View class={C.row} style={{ insetT: HEADER_H + i() * ROW_H }}>
            <Show when={item.at === index()}>
              <View class={C.rowOn} style={{ bgColor: color("selection") }} />
            </Show>
            <Text class={C.icon} style={{ textColor: color(item.at === index() ? "accent" : "dark_foreground") }}>{item.row.icon}</Text>
            <Text class={C.label} style={{ textColor: color(item.row.info ? "dark_foreground" : item.at === index() ? "bright_foreground" : "foreground") }}>
              {item.row.label}
            </Text>
            <Show when={item.row.value !== undefined || item.row.checked}>
              <Text class={C.chevron} style={{ textColor: color(item.row.checked ? "accent" : "foreground") }}>
                {item.row.checked && item.row.value === undefined ? CHECK : (item.row.value ?? "")}
              </Text>
            </Show>
          </View>
        )}
      </For>
      <View class={C.footer} style={{ bgColor: color("dark_background") }}>
        <Text class={C.hint} style={{ textColor: color(busy() ? "accent" : "dark_foreground") }}>
          {busy() || "A select   \u{2190}\u{2192} adjust   L1/R1 panel   Y forget   B close"}
        </Text>
      </View>
    </View>
  );
}
