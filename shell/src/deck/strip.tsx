// The deck's top band: the L1 pill, the five workspaces (the current one a
// rounded square as in Omarchy's bar, empty ones dimmed; tap one to go
// there), the workspace's layout (tap to toggle dwindle and scrolling),
// Omarchy's bar indicators (tap one for its panel in the body), and the R1
// pill. A pill latches its layer for one chord; both latched are the
// workspace layer.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { perform } from "../actions.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";
import { current, focus, layout, occupied, WORKSPACES } from "../workspaces.ts";
import { STRIP_H } from "./geometry.ts";
import { layer, pills, togglePill } from "./layer.ts";
import { closePanel, openPanel, showPanel, type PanelName } from "./panels.tsx";
import { dropWorkspace } from "./minimap.tsx";
import { pressed } from "./press.ts";

const PILL_W = 40;
const L_X = 4;
const TABS_X = 50;
const TAB_W = 34;
const LAYOUT_X = TABS_X + WORKSPACES * TAB_W + 4;
const LAYOUT_W = 76;
const IND_X = LAYOUT_X + LAYOUT_W + 6;
const IND_W = 34;
const R_X = 512 - 4 - PILL_W;
const INDICATORS: PanelName[] = ["bluetooth", "network", "audio", "power"];
const NUMBERS = Array.from({ length: WORKSPACES }, (_, i) => i);

/** The workspace tab under `x`, or -1. */
export function tabAt(x: number): number {
  if (x < TABS_X || x >= TABS_X + WORKSPACES * TAB_W) return -1;
  return Math.floor((x - TABS_X) / TAB_W);
}

/** The strip's target under `x`, for the pressed look. */
export function stripTarget(x: number): string | null {
  if (x >= L_X && x < L_X + PILL_W) return "strip:L";
  if (x >= R_X) return "strip:R";
  const tab = tabAt(x);
  if (tab >= 0) return `strip:ws${tab}`;
  if (x >= LAYOUT_X && x < LAYOUT_X + LAYOUT_W) return "strip:layout";
  const i = Math.floor((x - IND_X) / IND_W);
  if (x >= IND_X && i < INDICATORS.length) return `strip:${INDICATORS[i]}`;
  return null;
}

export function stripTap(x: number) {
  const target = stripTarget(x);
  if (!target) return;
  const what = target.slice(6);
  if (what === "L") return togglePill("l");
  if (what === "R") return togglePill("r");
  if (what === "layout") return perform("layout");
  if (what.startsWith("ws")) return focus(Number(what.slice(2)));
  const panel = what as PanelName;
  if (openPanel() === panel) closePanel();
  else showPanel(panel);
}

function Pill(props: { x: number; label: string; on: () => boolean; target: string }) {
  return (
    <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: props.x, width: PILL_W, bgColor: color(props.on() ? "accent" : pressed(props.target) ? "selection" : "dark_background") }}>
      <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: PILL_W, textColor: color(props.on() ? "background" : "foreground") }}>
        {props.label}
      </Text>
    </View>
  );
}

export function Strip() {
  const glyph = (p: PanelName) => {
    const s = state();
    return p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
  };
  const lOn = () => pills().l || layer() === "window" || layer() === "workspace";
  const rOn = () => pills().r || layer() === "move" || layer() === "workspace";
  return (
    <View class="absolute left-0 top-0 w-[512]" style={{ height: STRIP_H, bgColor: color("background") }}>
      <Pill x={L_X} label="L1" on={lOn} target="strip:L" />
      <For each={NUMBERS}>
        {(n) => (
          <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: TABS_X + n * TAB_W, width: TAB_W - 4, bgColor: color(dropWorkspace() === n ? "accent" : pressed(`strip:ws${n}`) ? "selection" : "background") }}>
            <Show
              when={current() === n}
              fallback={
                <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: TAB_W - 4, textColor: color(occupied(n) ? "foreground" : "muted") }}>
                  {String(n + 1)}
                </Text>
              }
            >
              <View class="absolute top-[5] h-[10] w-[10] rounded-sm" style={{ insetL: (TAB_W - 4 - 10) / 2, bgColor: color("bright_foreground") }} />
            </Show>
          </View>
        )}
      </For>
      <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: LAYOUT_X, width: LAYOUT_W, bgColor: color(pressed("strip:layout") ? "selection" : "dark_background") }}>
        <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: LAYOUT_W, textColor: color("dark_foreground") }}>{layout()}</Text>
      </View>
      <For each={INDICATORS}>
        {(p, i) => (
          <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: IND_X + i() * IND_W, width: IND_W - 4, bgColor: color(openPanel() === p ? "selection" : pressed(`strip:${p}`) ? "selection" : "background") }}>
            <Text class="absolute left-0 top-[3] text-center font-mono text-sm leading-[14]" style={{ width: IND_W - 4, textColor: color(openPanel() === p ? "accent" : "foreground") }}>{glyph(p)}</Text>
          </View>
        )}
      </For>
      <Pill x={R_X} label="R1" on={rOn} target="strip:R" />
    </View>
  );
}
