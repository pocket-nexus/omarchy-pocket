// The bar's indicator glyphs from SystemState, chosen by Omarchy's own panel
// models (generated/*-model.js) or, where the choice lives in a panel's QML,
// by the same rules copied here.
import type { SystemState } from "./bridge.ts";
import { batteryIcon } from "./generated/power-model.js";
import { connectionIcon } from "./generated/network-model.js";

// UPower's device states, which the power model compares against
const UPOWER = { Charging: 1, Discharging: 2, Empty: 3, FullyCharged: 4, PendingCharge: 5, PendingDischarge: 6 };

export function batteryGlyph(battery: SystemState["battery"]): string {
  if (!battery) return "";
  const full = battery.charging && battery.percent >= 100;
  const device = {
    isPresent: true,
    percentage: battery.percent / 100,
    state: full ? UPOWER.FullyCharged : battery.charging ? UPOWER.Charging : UPOWER.Discharging,
    // the charger is drawing current; a still charger reads as the charge threshold
    changeRate: battery.charging ? 1 : 0,
  };
  return batteryIcon(device, !battery.charging, UPOWER);
}

export function networkGlyph(network: SystemState["network"] | undefined): string {
  if (!network || network.kind === "none") return connectionIcon("disconnected", -1, "none");
  return connectionIcon(network.kind, network.signal ?? 0, "full");
}

/** panels/audio/Panel.qml outputIcon() */
export function audioGlyph(audio: SystemState["audio"]): string {
  if (!audio || audio.muted) return "\u{eee8}";
  const v = audio.volume / 100;
  if (v >= 0.67) return "\u{f028}";
  if (v >= 0.34) return "\u{f027}";
  if (v > 0) return "\u{f026}";
  return "\u{eee8}";
}

/** panels/bluetooth/Panel.qml icon (no adapter: no glyph) */
export function bluetoothGlyph(bluetooth: SystemState["bluetooth"]): string {
  if (!bluetooth) return "";
  return bluetooth.powered ? "\u{f00af}" : "\u{f00b2}";
}
