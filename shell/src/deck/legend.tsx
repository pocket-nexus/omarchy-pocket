// What the buttons do while a shoulder is held, drawn on the deck as the
// controls that sit around it: the D-pad and the stick left of the panel,
// A B X Y and START/SELECT right of it, the shoulders along the top, each
// control at its side of the panel with the icon of what it does and one
// word. The held layer's name is in the middle. It shows once a shoulder has
// been held LEGEND_AFTER frames (a chord pressed at once never sees it) and
// goes with the shoulder. Every icon comes from chords.ts, the table the
// dispatcher reads, so the picture cannot show what a button does not do; a
// control the layer does not bind is drawn dim and empty.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { chordFor, glyphFor, LAYER_GLYPH, stickGlyph, triggerLabel, type Glyph, type Layer } from "../chords.ts";
import { heldLayer } from "../held.ts";
import { inkShift } from "../ink.ts";
import { glide } from "../motion.ts";
import { color } from "../theme.ts";
import { layout } from "../workspaces.ts";

/** frames a shoulder is held before the legend shows */
export const LEGEND_AFTER = 14;
const [due, setDue] = createSignal(false);

/** Once per frame: whether a shoulder has been held long enough. */
export function tickLegend(held: boolean, frames: number) {
  const next = held && frames >= LEGEND_AFTER;
  if (next !== due()) setDue(next);
}

/** the icon sizes in use: text-base and text-2xl */
const SMALL = 16;
const LARGE = 24;
const LEAD = { [SMALL]: 18, [LARGE]: 28 } as const;

/** An icon centred on (cx, cy) by its ink. */
function Icon(props: { glyph: string; cx: number; cy: number; px: typeof SMALL | typeof LARGE; tone: string }) {
  const box = 40;
  return (
    <Text
      class={props.px === LARGE ? "absolute text-center text-2xl leading-[28]" : "absolute text-center font-mono text-base leading-[18]"}
      style={{ insetL: props.cx - box / 2 - inkShift(props.glyph, props.px), insetT: props.cy - LEAD[props.px] / 2, width: box, height: LEAD[props.px], textColor: color(props.tone) }}
    >
      {props.glyph}
    </Text>
  );
}

/** One word centred under a control. */
function Word(props: { text: string; cx: number; top: number; w?: number; tone?: string }) {
  const w = props.w ?? 72;
  return (
    <Text class="absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetL: props.cx - w / 2, insetT: props.top, width: w, textColor: color(props.tone ?? "foreground") }}>
      {props.text}
    </Text>
  );
}

const DIM = 0.32;

/** A round button: the action's icon inside, its letter on the rim, the word under it. */
function Face(props: { letter: string; cx: number; cy: number; glyph: Glyph | null }) {
  // the literal's w-[44] h-[44]: rounded-full needs a size known at build time
  const r = 22;
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ opacity: props.glyph ? 1 : DIM }}>
      <View class="absolute w-[44] h-[44] rounded-full border-[1]" style={{ insetL: props.cx - r, insetT: props.cy - r, bgColor: color("dark_background"), borderColor: color("muted") }} />
      <Show when={props.glyph}>
        {(g) => <Icon glyph={g().icon} cx={props.cx} cy={props.cy} px={g().small ? SMALL : LARGE} tone="bright_foreground" />}
      </Show>
      <View class="absolute w-[15] h-[15] rounded-full" style={{ insetL: props.cx + r - 12, insetT: props.cy - r - 3, bgColor: color("muted") }} />
      <Text class="absolute h-[15] w-[15] text-center font-mono text-xs leading-[15]" style={{ insetL: props.cx + r - 12, insetT: props.cy - r - 3, textColor: color("darker_background") }}>
        {props.letter}
      </Text>
      <Show when={props.glyph}>{(g) => <Word text={g().word} cx={props.cx} top={props.cy + r + 3} />}</Show>
    </View>
  );
}

/** A shoulder or a trigger along the top: its name, lit while held, or the
 *  icon of what it does with the word under it. */
function Shoulder(props: { name: string; x: number; lit: boolean; glyph: Glyph | null; bound: boolean }) {
  const w = 60;
  const h = 26;
  const y = 8;
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ opacity: props.lit || props.bound ? 1 : DIM }}>
      <View class="absolute rounded-md border-[1]" style={{ insetL: props.x, insetT: y, width: w, height: h, bgColor: color(props.lit ? "accent" : "dark_background"), borderColor: color(props.lit ? "accent" : "muted") }} />
      <Show
        when={props.glyph}
        fallback={
          <Text class="absolute text-center font-mono text-sm leading-[16]" style={{ insetL: props.x, insetT: y + 5, width: w, height: 16, textColor: color(props.lit ? "darker_background" : "foreground") }}>
            {props.name}
          </Text>
        }
      >
        {(g) => (
          <>
            <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: props.x + 7, insetT: y + 6, width: 20, height: 14, textColor: color("dark_foreground") }}>
              {props.name}
            </Text>
            <Icon glyph={g().icon} cx={props.x + w - 18} cy={y + h / 2} px={SMALL} tone="bright_foreground" />
            <Word text={g().word} cx={props.x + w / 2} top={y + h + 3} />
          </>
        )}
      </Show>
    </View>
  );
}

/** START or SELECT: a pill with its name, the icon and the word beside it. */
function Pill(props: { name: string; y: number; glyph: Glyph | null }) {
  const x = 348;
  // the literal's w-[152] h-[30]
  const w = 152;
  const h = 30;
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ opacity: props.glyph ? 1 : DIM }}>
      <View class="absolute w-[152] h-[30] rounded-full border-[1]" style={{ insetL: x, insetT: props.y, bgColor: color("dark_background"), borderColor: color("muted") }} />
      <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: x + 12, insetT: props.y + 8, width: 48, height: 14, textColor: color("dark_foreground") }}>
        {props.name}
      </Text>
      <Show when={props.glyph}>
        {(g) => (
          <>
            <Icon glyph={g().icon} cx={x + 70} cy={props.y + h / 2} px={SMALL} tone="bright_foreground" />
            <Text class="absolute overflow-hidden font-mono text-xs leading-[14]" style={{ insetL: x + 84, insetT: props.y + 8, width: w - 90, height: 14, textColor: color("foreground") }}>
              {g().word}
            </Text>
          </>
        )}
      </Show>
    </View>
  );
}

const DPAD = { cx: 104, cy: 150, arm: 40 } as const;
/** r matches the stick's w-[56] literal */
const STICK = { cx: 104, cy: 292, r: 28 } as const;
const FACES = { cx: 408, cy: 150, step: 54 } as const;

/** The D-pad: a cross, an arrow at each arm's end. When the four arms do one
 *  thing its icon sits in the middle; when the axes differ (the workspace
 *  layer) each arm carries its own icon and the word names both. */
function Dpad(props: { layer: Layer }) {
  const arms = createMemo(() => {
    const l = layout();
    return ([
      [BTN.LEFT, -1, 0, "\u{f0141}"],
      [BTN.RIGHT, 1, 0, "\u{f0142}"],
      [BTN.UP, 0, -1, "\u{f0143}"],
      [BTN.DOWN, 0, 1, "\u{f0140}"],
    ] as const).map(([button, dx, dy, arrow]) => {
      const chord = chordFor(props.layer, button);
      return { dx, dy, arrow, glyph: chord ? glyphFor(chord.action, l) : null };
    });
  });
  const one = createMemo(() => new Set(arms().map((a) => a.glyph?.word ?? "")).size === 1);
  const word = createMemo(() => (one() ? (arms()[0]!.glyph?.word ?? "") : `${arms()[0]!.glyph?.word ?? ""} · ${arms()[2]!.glyph?.word ?? ""}`));
  const { cx, cy, arm } = DPAD;
  return (
    <>
      <View class="absolute rounded-md" style={{ insetL: cx - 1.5 * arm, insetT: cy - arm / 2, width: 3 * arm, height: arm, bgColor: color("dark_background") }} />
      <View class="absolute rounded-md" style={{ insetL: cx - arm / 2, insetT: cy - 1.5 * arm, width: arm, height: 3 * arm, bgColor: color("dark_background") }} />
      <For each={arms()}>
        {(a) => <Icon glyph={one() ? a.arrow : (a.glyph?.icon ?? a.arrow)} cx={cx + a.dx * arm} cy={cy + a.dy * arm} px={SMALL} tone={one() ? "dark_foreground" : "bright_foreground"} />}
      </For>
      <Show when={one() && arms()[0]!.glyph}>
        <Icon glyph={arms()[0]!.glyph!.icon} cx={cx} cy={cy} px={LARGE} tone="bright_foreground" />
      </Show>
      <Word text={word()} cx={cx} top={cy + 1.5 * arm + 6} w={150} />
    </>
  );
}

/** The stick, dim when the layer gives it nothing. */
function Stick(props: { layer: Layer }) {
  const glyph = () => stickGlyph(props.layer);
  const { cx, cy, r } = STICK;
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ opacity: glyph() ? 1 : DIM }}>
      <View class="absolute w-[56] h-[56] rounded-full border-[1]" style={{ insetL: cx - r, insetT: cy - r, bgColor: color("dark_background"), borderColor: color("muted") }} />
      <View class="absolute w-[28] h-[28] rounded-full" style={{ insetL: cx - r / 2, insetT: cy - r / 2, bgColor: color("muted", 0.5) }} />
      <Show when={glyph()}>
        {(g) => (
          <>
            <Icon glyph={g().icon} cx={cx} cy={cy} px={LARGE} tone="bright_foreground" />
            <Word text={g().word} cx={cx} top={cy + r + 4} />
          </>
        )}
      </Show>
    </View>
  );
}

/** The deck's legend. It stays mounted and fades on the core's track; it
 *  follows the held layer while it shows and keeps the last one while it fades. */
export function DeckLegend() {
  let node: NodeMirror | undefined;
  const layer = createMemo<Layer>((last) => (heldLayer() === "plain" ? (last ?? "window") : heldLayer()), "window");
  const face = (button: number) => {
    const chord = chordFor(layer(), button);
    return chord ? glyphFor(chord.action, layout()) : null;
  };
  /** L2/R2 under this layer: null when they do nothing in this layout */
  const trigger = (button: number) => (triggerLabel(layer(), layout()) === "—" ? null : face(button));
  const title = () => LAYER_GLYPH[layer()];
  createEffect(on(due, (d) => glide(node, "opacity", d ? 1 : 0, d ? 120 : 160), { defer: true }));
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384] contain-strict" style={{ bgColor: color("darker_background"), opacity: 0 }} ref={(n: NodeMirror) => (node = n)}>
      <Shoulder name="L1" x={12} lit={layer() !== "move"} glyph={null} bound />
      <Shoulder name="L2" x={80} lit={false} glyph={trigger(BTN.ZL)} bound={!!trigger(BTN.ZL)} />
      <Shoulder name="R2" x={372} lit={false} glyph={trigger(BTN.ZR)} bound={!!trigger(BTN.ZR)} />
      <Shoulder name="R1" x={440} lit={layer() !== "window"} glyph={null} bound />

      <Icon glyph={title().icon} cx={256} cy={136} px={LARGE} tone="accent" />
      <Text class="absolute left-[156] w-[200] text-center font-mono text-base leading-[18]" style={{ insetT: 156, height: 18, textColor: color("bright_foreground") }}>
        {title().word}
      </Text>

      <Dpad layer={layer()} />
      <Stick layer={layer()} />

      <Face letter="X" cx={FACES.cx} cy={FACES.cy - FACES.step} glyph={face(BTN.TRIANGLE)} />
      <Face letter="Y" cx={FACES.cx - FACES.step} cy={FACES.cy} glyph={face(BTN.SQUARE)} />
      <Face letter="A" cx={FACES.cx + FACES.step} cy={FACES.cy} glyph={face(BTN.CIRCLE)} />
      <Face letter="B" cx={FACES.cx} cy={FACES.cy + FACES.step} glyph={face(BTN.CROSS)} />

      <Pill name="START" y={278} glyph={face(BTN.START)} />
      <Pill name="SELECT" y={318} glyph={face(BTN.SELECT)} />
    </View>
  );
}
