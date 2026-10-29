// The palette every element colours itself from: Omarchy's colors.toml names
// (accent, background, foreground, ...). It starts as the theme the package
// was built with, takes the theme omarchy-pocketd reports, and changes when
// `omarchy-theme-set` calls `omarchy-shell shell applyTheme <colors> <shell>`.
import { createEffect, createRoot, createSignal } from "solid-js";
import { PALETTE } from "./generated/palette.ts";
import { serve, state } from "./system.ts";

const [palette, setPalette] = createSignal<Record<string, string>>(PALETTE);

export { palette };

/** A palette colour, with an optional alpha from 0 to 1. */
export function color(name: string, alpha = 1): string {
  const hex = palette()[name] ?? PALETTE[name] ?? "#ff00ff";
  if (alpha >= 1) return hex;
  const a = Math.round(Math.max(0, alpha) * 255);
  return hex + (a < 16 ? "0" : "") + a.toString(16);
}

/** `name = "#rrggbb"` lines of a colors.toml. */
export function parseColors(toml: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const line of toml.split("\n")) {
    const match = /^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line.trim());
    if (match) colors[match[1]!] = match[2]!.toLowerCase();
  }
  return colors;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 to text; colors.toml is ASCII. */
export function fromBase64(text: string): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const c of text) {
    const digit = BASE64.indexOf(c);
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

function apply(colors: Record<string, string>) {
  if (Object.keys(colors).length) setPalette({ ...PALETTE, ...colors });
}

createRoot(() =>
  createEffect(() => {
    const theme = state()?.theme;
    if (theme) apply(theme.colors);
  }),
);

serve("shell", {
  applyTheme: (colorsB64) => (apply(parseColors(fromBase64(colorsB64 ?? ""))), "ok"),
});
