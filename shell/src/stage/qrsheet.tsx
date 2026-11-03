// A QR code over the stage: a link the device cannot open itself (a
// Tailscale login) drawn for a phone to scan, with the link's text under it.
// Any button closes it (app.tsx press). The code comes from PocketJS's
// encoder (tools/pocket-link/qr.ts), byte mode, as the pairing QR does; each
// row's dark modules merge into runs, one View per run.
import { createMemo, createSignal, For, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { encodeQr } from "../../../vendor/pocketjs/tools/pocket-link/qr.ts";
import { color } from "../theme.ts";

const [sheet, setSheet] = createSignal<{ title: string; url: string } | null>(null);
export const qrOpen = () => sheet() !== null;
export const closeQr = () => setSheet(null);
export const showQr = (title: string, url: string) => setSheet({ title, url });

const BOX = 260;
const QUIET = 2;

interface Run {
  x: number;
  y: number;
  w: number;
}

function runsOf(modules: boolean[][]): Run[] {
  const out: Run[] = [];
  modules.forEach((row, y) => {
    let start = -1;
    row.forEach((dark, x) => {
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        out.push({ x: start, y, w: x - start });
        start = -1;
      }
    });
    if (start >= 0) out.push({ x: start, y, w: row.length - start });
  });
  return out;
}

export function QrSheet() {
  const code = createMemo(() => {
    const s = sheet();
    if (!s) return null;
    try {
      // bytes, not a string: QuickJS has no TextEncoder, and a link is ASCII
      const qr = encodeQr(Uint8Array.from(s.url, (c) => c.charCodeAt(0) & 0xff));
      const cell = Math.max(2, Math.floor(BOX / (qr.size + 2 * QUIET)));
      return { runs: runsOf(qr.modules), size: qr.size, cell, side: cell * (qr.size + 2 * QUIET) };
    } catch {
      return null;
    }
  });
  return (
    <Show when={sheet()}>
      {(s) => (
        <View
          class="absolute left-[12] top-[24] w-[488] h-[348] rounded-md border-[1]"
          style={{ bgColor: color("background", 0.96), borderColor: color("accent") }}
          ref={(node: NodeMirror) => {
            jump(node, "opacity", 0);
            animate(node, "opacity", 1, { dur: 150, easing: "out" });
          }}
        >
          <Text class="absolute left-[12] top-[8] font-mono text-sm leading-[16]" style={{ textColor: color("bright_foreground") }}>{s().title}</Text>
          <Text class="absolute right-[12] top-[9] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>any button closes</Text>
          <View class="absolute left-[12] top-[30] w-[464] h-[1]" style={{ bgColor: color("muted") }} />
          <Show when={code()}>
            {(q) => (
              <View class="absolute bg-white" style={{ insetL: (488 - q().side) / 2, insetT: 40, width: q().side, height: q().side }}>
                <For each={q().runs}>
                  {(run) => <View class="absolute bg-black" style={{ insetL: (run.x + QUIET) * q().cell, insetT: (run.y + QUIET) * q().cell, width: run.w * q().cell, height: q().cell }} />}
                </For>
              </View>
            )}
          </Show>
          <Show when={!code()}>
            <Text class="absolute left-[12] top-[60] font-mono text-xs leading-[14]" style={{ textColor: color("foreground") }}>The link is too long for a code; type it instead.</Text>
          </Show>
          <Text class="absolute left-[12] h-[14] overflow-hidden font-mono text-xs leading-[14] text-center" style={{ insetT: 348 - 26, width: 464, textColor: color("foreground") }}>{s().url}</Text>
        </View>
      )}
    </Show>
  );
}
