// The panels Omarchy opens from the bar's indicators (plugins/panels:
// Bluetooth, Network, Audio, Power, and mihomo's Proxy) in the stage's card:
// a pointer click on the indicator, the deck's function row in the pad layout (deck/strip.tsx), or
// `omarchy-shell shell summon omarchy.network|...`. The panel has the keys
// while it is up: Up/Down move between rows, Enter acts, Left/Right adjust
// a slider, Escape closes it; the gamepad's Y forgets a saved network or a
// paired device. The highlight follows a row, not a position: rows keep
// their first order while the panel is open, though rescans re-sort them.
// A secured network asks for its password on the keyboard. The Network
// panel is PocketJS's system.wifi (`@pocketjs/framework/wifi`), which each
// device program answers for its own system (host/src/system.rs: Android's
// WifiManager on the AYN Thor, NetworkManager through omarchy-pocketd on the
// RG DS Plus), read again every second while it is open. The other panels'
// data comes from omarchy-pocketd (daemon/panels.ts), again every few
// seconds.
//
// A slider answers at once: the row shows the value the finger asked for,
// Omarchy's OSD shows it on the stage, and one request at a time carries the
// newest value to the daemon; the row reads the device's own value back
// once the last request has landed.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import {
  connectSavedNetwork, disconnectNetwork, forgetNetwork, joinNetwork, openWifiSettings, savedSlotOf, scanNetworks, setWifiEnabled,
  wifiCanDisconnect, wifiHasSettings, wifiHost, wifiStatus, type WifiStatus,
} from "@pocketjs/framework/wifi";
import { request } from "../bridge.ts";
import type { AudioDevice, AudioPanel, BluetoothPanel, PowerPanel, ProxyPanel, TailscalePanel } from "../../../daemon/protocol.ts";
import { C } from "../classes.ts";
import { CJK_SLOT_14, levelOsd, LOCK_ICON, VOLUME_MAX } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { isAddressLike } from "../generated/bluetooth-model.js";
import { wifiIconFor } from "../generated/network-model.js";
import { profileIcon } from "../generated/power-model.js";
import { batteryGlyph } from "../indicators.ts";
import { fieldSink, setFieldSink, type KeySink } from "../keys.ts";
import { showOsd } from "./osd.tsx";
import { toast } from "./toasts.tsx";
import { state } from "../system.ts";
import { color } from "../theme.ts";
import { CARD_H, CARD_W } from "./geometry.ts";
import { createList, List } from "../deck/list.tsx";
import type { TouchFrame } from "../touch.ts";
import { showQr } from "./qrsheet.tsx";

export type PanelName = "tailscale" | "proxy" | "bluetooth" | "network" | "audio" | "power";
export const PANELS: PanelName[] = ["tailscale", "proxy", "bluetooth", "network", "audio", "power"];
const TITLES: Record<PanelName, string> = { tailscale: "Tailscale", proxy: "Proxy", bluetooth: "Bluetooth", network: "Network", audio: "Audio", power: "Power" };
const PROXY_MODES = ["rule", "global", "direct"];
/** a node's name as the card draws it: flags (regional indicators) have no glyph */
const nodeName = (name: string) => name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();

interface Row {
  icon: string;
  label: string;
  /** the row's identity while its label changes ("Scan", "Scanning..."); the label otherwise */
  key?: string;
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
/** system.wifi's status is the host's last reading: the Network panel reads it every second */
const WIFI_EVERY = 1;
const ERROR = "\u{f015a}";
const CHECK = "\u{f012c}";
const LOCK = LOCK_ICON;
const LAN = "\u{f0318}";
const KEY = "\u{f0306}";
const LOGOUT = "\u{f0343}";
const ONLINE = "\u{f0765}";
const OFFLINE = "\u{f0766}";
const STEP = 5;

const [panel, setPanel] = createSignal<PanelName | null>(null);
/** the highlighted row, by its label: rows come and go and reorder as the
 *  daemon reports, and the highlight stays on the same row */
const [selected, setSelected] = createSignal("");
/** while a panel stays open, rows keep the order they first appeared in */
let seen = new Map<string, number>();
const [network, setNetwork] = createSignal<WifiStatus | null>(null);
const [audio, setAudio] = createSignal<AudioPanel | null>(null);
const [power, setPower] = createSignal<PowerPanel | null>(null);
const [proxy, setProxy] = createSignal<ProxyPanel | null>(null);
const [tailscale, setTailscale] = createSignal<TailscalePanel | null>(null);
const [bluetooth, setBluetooth] = createSignal<BluetoothPanel | null>(null);
/** the SSID whose password the keyboard is taking; `short` once Enter came
 *  before WPA's shortest passphrase */
const [entry, setEntry] = createSignal<{ ssid: string; text: string; short?: boolean } | null>(null);
/** WPA's shortest passphrase: Enter on less keeps the field open, so a second
 *  press of A never joins a secured network with no password */
const PASS_MIN = 8;
const [busy, setBusy] = createSignal("");
/** the power profile asked for, shown checked until the panel reads it back */
const [profileAsked, setProfileAsked] = createSignal<string | null>(null);
let refreshing = 0;

export { panel as openPanel };
export const passwordEntry = () => entry() !== null;

const fail = (title: string) => (error: unknown) => toast({ icon: ERROR, title, body: String(error).replace(/^Error: /, ""), tone: "error" });

/** Reads the panel's data again; the promise settles once the rows have it. */
function load(name: PanelName, rescan = false): Promise<unknown> {
  if (name === "bluetooth") return request<BluetoothPanel>({ method: "bluetooth" }).then(setBluetooth, fail("Bluetooth"));
  if (name === "network") {
    if (rescan) scanNetworks();
    setNetwork(wifiStatus());
    return Promise.resolve();
  }
  if (name === "audio") return request<AudioPanel>({ method: "audio" }).then(setAudio, fail("Audio"));
  if (name === "power") return request<PowerPanel>({ method: "power" }).then(setPower, fail("Power"));
  if (name === "tailscale") return request<TailscalePanel>({ method: "tailscale" }).then(setTailscale, fail("Tailscale"));
  return request<ProxyPanel>({ method: "proxy" }).then(setProxy, fail("Proxy"));
}

function poll(token: number) {
  after(panel() === "network" ? WIFI_EVERY : REFRESH_EVERY, () => {
    const name = panel();
    if (token !== refreshing || !name) return;
    if (!entry() && !busy() && !sliding.size) load(name);
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
  endEntry();
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

/** A slider's value as the finger set it, by the slider's id, while a
 *  request for it is out or waiting: the row shows this, not the device's
 *  last reading. */
const [asked, setAsked] = createSignal<Record<string, number>>({});
const sliding = new Map<string, { inFlight: boolean; next: number | null; send(value: number): Promise<unknown>; title: string }>();

/** Moves slider `id` to `value` now: the row and the OSD show it, one
 *  request at a time carries the newest value, and the device's reading
 *  comes back once the last request lands. */
function slide(id: string, value: number, send: (value: number) => Promise<unknown>, title: string, osd: { icon: string; max?: number }) {
  setAsked((a) => ({ ...a, [id]: value }));
  showOsd(JSON.stringify(levelOsd(osd.icon, value, osd.max)));
  const s = sliding.get(id) ?? { inFlight: false, next: null, send, title };
  s.send = send;
  sliding.set(id, s);
  if (s.inFlight) {
    s.next = value;
    return;
  }
  const go = (v: number) => {
    s.inFlight = true;
    s.send(v).then(
      () => settled(),
      (error) => {
        fail(title)(error);
        settled();
      },
    );
  };
  const settled = () => {
    s.inFlight = false;
    if (s.next !== null) {
      const v = s.next;
      s.next = null;
      return go(v);
    }
    sliding.delete(id);
    // the row keeps the asked value until the device's own reading is in,
    // so a press that lands meanwhile adds to it and not to the old reading
    const name = panel();
    const done = () => {
      if (!sliding.has(id)) setAsked(({ [id]: _, ...rest }) => rest);
    };
    if (name) load(name).then(done, done);
    else done();
  };
  go(value);
}

/** A system.wifi action: it returns at once and its outcome shows in later
 *  readings; a refusal's reason (WifiStatus.error) shows as a notice. */
function wifiAct(title: string, done: boolean) {
  const before = network()?.error ?? "";
  const check = () => {
    const status = wifiStatus();
    setNetwork(status);
    const reason = status?.error ?? "";
    if (reason && (!done || reason !== before)) toast({ icon: ERROR, title, body: reason, tone: "error" });
  };
  // the host's reading of a refusal lands within a tick or two
  after(0.4, check);
}

/** Connects to `ssid`: through its saved connection, or joining it with `password`. */
function connect(ssid: string, password = "") {
  const status = network();
  const slot = status && !password ? savedSlotOf(status, ssid) : -1;
  wifiAct(ssid, slot >= 0 ? connectSavedNetwork(slot) : joinNetwork(ssid, password));
}

/** the password field's sink, so ending the entry never takes another field's keyboard */
let entrySink: KeySink | null = null;

function askPassword(ssid: string) {
  setEntry({ ssid, text: "" });
  entrySink = {
    text: (ch) => setEntry((e) => e && { ...e, text: e.text + ch, short: false }),
    key: (name) => {
      const e = entry();
      if (!e) return;
      if (name === "Backspace") setEntry({ ...e, text: [...e.text].slice(0, -1).join("") });
      else if (name === "Enter") {
        if ([...e.text].length < PASS_MIN) return setEntry({ ...e, short: true });
        endEntry();
        connect(e.ssid, e.text);
      } else if (name === "Escape") endEntry();
    },
    field: () => {
      const e = entry();
      return e ? `${LOCK} ${e.ssid}: ${"•".repeat([...e.text].length)}_` : "";
    },
    hint: () => (entry()?.short ? `${PASS_MIN} characters at least · START cancels` : "A connects · B Backspace · START cancels"),
  };
  setFieldSink(entrySink);
}

function endEntry() {
  if (!entry()) return;
  setEntry(null);
  if (fieldSink() === entrySink) setFieldSink(null);
  entrySink = null;
}

function deviceRows(kind: "sink" | "source", list: AudioDevice[], title: string, icon: string): Row[] {
  const current = list.find((d) => d.current);
  const rows: Row[] = [];
  if (current) {
    const id = `${kind}:${current.name}`;
    const level = () => asked()[id] ?? current.volume;
    rows.push({
      icon,
      label: title,
      value: current.muted ? "Muted" : `${Math.round(level())}%`,
      activate: () => change("", request({ method: "audioSet", kind, name: current.name, muted: !current.muted }), title),
      adjust: (delta) =>
        slide(id, Math.max(0, Math.min(VOLUME_MAX, level() + delta * STEP)), (volume) => request({ method: "audioSet", kind, name: current.name, volume }), title, {
          icon: kind === "sink" ? "\u{f057e}" : "\u{f036c}",
          max: VOLUME_MAX,
        }),
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
      if (!wifiHost()) return [{ icon: "", label: "This device has no Wi-Fi", info: true }];
      if (!n) return [{ icon: "", label: "Reading networks...", info: true }];
      const on = n.state !== "off";
      const list: Row[] = [
        {
          icon: on ? "\u{f05a9}" : "\u{f05aa}",
          label: "Wi-Fi",
          value: n.state === "connecting" ? "Connecting" : on ? "On" : "Off",
          activate: () => wifiAct("Wi-Fi", setWifiEnabled(!on)),
        },
      ];
      // what the system refused, or what it needs first (Android's location access)
      if (n.error) list.push({ icon: ERROR, label: n.error, info: true });
      if (n.ssid && wifiCanDisconnect()) {
        list.push({ icon: "", label: `Disconnect ${n.ssid}`, value: n.address, activate: () => wifiAct("Wi-Fi", disconnectNetwork()) });
      }
      if (on) list.push({ icon: "\u{f0450}", key: "scan", label: n.scanning ? "Scanning..." : "Scan", activate: () => wifiAct("Wi-Fi", scanNetworks()) });
      if (wifiHasSettings()) list.push({ icon: "\u{f0493}", label: "System Wi-Fi settings", activate: () => void openWifiSettings() });
      for (const w of n.networks ?? []) {
        const active = w.ssid === n.ssid && n.state !== "idle";
        const signal = w.signal ?? w.strength * 33;
        const slot = savedSlotOf(n, w.ssid);
        const saved = w.saved === true || slot >= 0;
        list.push({
          icon: wifiIconFor(signal),
          label: w.secure ? `${w.ssid} ${LOCK}` : w.ssid,
          value: active ? (n.state === "connecting" ? "Connecting" : "Connected") : saved ? "Saved" : `${signal}%`,
          checked: active && n.state === "connected",
          activate: () => (active ? undefined : w.secure && !saved ? askPassword(w.ssid) : connect(w.ssid)),
          forget: slot >= 0 ? () => wifiAct(w.ssid, forgetNetwork(slot)) : undefined,
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
        const level = () => asked()["brightness"] ?? p.brightness!;
        list.push({
          icon: "\u{f00df}",
          label: "Brightness",
          value: `${Math.round(level())}%`,
          adjust: (delta) => slide("brightness", Math.max(5, Math.min(100, level() + delta * STEP)), (brightness) => request({ method: "powerSet", brightness }), "Brightness", { icon: "\u{f00df}" }),
        });
      }
      const chosen = profileAsked() ?? p.profile;
      for (const profile of p.profiles) {
        list.push({
          icon: profileIcon(profile),
          label: profile,
          checked: profile === chosen,
          activate: () => {
            setProfileAsked(profile);
            change("", request({ method: "powerSet", profile }).finally(() => setProfileAsked(null)), "Power profile");
          },
        });
      }
      return list;
    }
    case "tailscale": {
      const t = tailscale();
      if (!t) return [{ icon: "", label: "Asking tailscaled...", info: true }];
      if (!t.installed) return [{ icon: ERROR, label: "tailscale is not installed", info: true }];
      const list: Row[] = [
        {
          icon: LAN,
          label: "Tailscale",
          value: t.running ? "On" : "Off",
          checked: t.running,
          activate: () => change(t.running ? "Stopping tailscaled" : "Starting tailscaled", request({ method: "tailscaleSet", running: !t.running }), "Tailscale"),
        },
      ];
      if (!t.running) return list;
      if (t.state === "NeedsLogin") {
        // The first press asks tailscaled for a login link; once it is in, the row shows it as a QR code.
        list.push({
          icon: KEY,
          label: "Log in",
          value: t.authUrl ? "Show the code" : "",
          activate: () => {
            if (!t.authUrl) return change("Asking Tailscale for a login link", request({ method: "tailscaleSet", up: true }), "Tailscale");
            closePanel();
            showQr("Log in to Tailscale", t.authUrl);
          },
        });
        return list;
      }
      const up = t.state === "Running";
      list.push({
        icon: up ? CHECK : "",
        label: "Connected",
        value: up ? t.self?.ip || "Up" : t.state === "Stopped" ? "Down" : t.state,
        checked: up,
        activate: () => change(up ? "Disconnecting" : "Connecting", request({ method: "tailscaleSet", up: !up }), "Tailscale"),
      });
      if (t.self?.dns) list.push({ icon: "", label: "Name", value: t.self.dns, info: true });
      if (t.tailnet) list.push({ icon: "", label: "Tailnet", value: t.tailnet, info: true });
      for (const peer of t.peers) list.push({ icon: peer.online ? ONLINE : OFFLINE, label: peer.name, value: peer.ip, info: true });
      list.push({ icon: LOGOUT, label: "Log out", activate: () => change("Logging out", request({ method: "tailscaleSet", logout: true }), "Tailscale") });
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
          // Enter tests the group's nodes; left and right pick the previous or next one
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

const keyOf = (row: Row) => row.key ?? row.label;

const rows = createMemo((): Row[] => {
  const list = rawRows();
  for (const row of list) if (!seen.has(keyOf(row))) seen.set(keyOf(row), seen.size);
  return [...list].sort((a, b) => seen.get(keyOf(a))! - seen.get(keyOf(b))!);
});

const index = () => Math.max(0, rows().findIndex((row) => keyOf(row) === selected()));

const list = createList(ROW_H, HEADER_H, ROWS);

function setIndex(at: number) {
  const all = rows();
  const i = Math.max(0, Math.min(all.length - 1, at));
  const row = all[i];
  if (!row) return;
  setSelected(keyOf(row));
  list.reveal(i, all.length);
}

function move(delta: number) {
  setIndex(index() + delta);
}

/** A key at the panel; "Forget" is the gamepad's Y. */
export function panelKey(name: string) {
  const row = rows()[Math.min(index(), rows().length - 1)];
  switch (name) {
    case "Up":
      return move(-1);
    case "Down":
      return move(1);
    case "Left":
      return row?.adjust?.(-1);
    case "Right":
      return row?.adjust?.(1);
    case "Enter":
      return row?.activate?.();
    case "Forget":
      return row?.forget?.();
    case "Escape":
    case "Backspace":
      return closePanel();
  }
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

/** The panel's title, for the strip. */
export const panelTitle = () => TITLES[panel() ?? "network"];

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
