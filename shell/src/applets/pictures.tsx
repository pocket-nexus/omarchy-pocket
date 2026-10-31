// Pictures: the images in ~/Pictures (screenshots land there) and the
// theme's backgrounds, one at a time in the window, scaled into the panel's
// 1024 x 768 pixels by omarchy-pocketd (the wallpaper path with `fit`),
// uploaded as textures and drawn at the window's size. Up and Down go
// through the pictures, Enter switches between the whole picture and the
// panel filled, and Tab makes the picture Omarchy's background
// (omarchy-theme-bg-set). A caption along the bottom names the picture.
import { createSignal, onMount, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { request, run } from "../bridge.ts";
import type { Picture, WallTile } from "../../../daemon/protocol.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { quote } from "../menu.ts";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";
import { register } from "./applet.ts";

interface Loader {
  loadTexture(path: string, w: number, h: number): number;
}

const [list, setList] = createSignal<Picture[]>([]);
const [selected, setSelected] = createSignal(0);
const [fill, setFill] = createSignal(false);
const [shown, setShown] = createSignal<string | null>(null);
const [status, setStatus] = createSignal("");
const nodes: (NodeMirror | undefined)[] = [];
let handles: number[] = [];
let wanted = 0;

/** Puts the loaded textures on the window's image nodes (new ones after a remount). */
function apply() {
  if (handles.length === nodes.length && nodes.every((n) => n)) handles.forEach((handle, i) => getOps().setImage(nodes[i]!.id, handle));
}

function release() {
  for (const h of handles) getOps().freeTexture?.(h);
  handles = [];
  setShown(null);
}

/** Shows the highlighted picture once the highlight has rested a moment. */
function show() {
  const mine = ++wanted;
  after(0.25, async () => {
    const picture = list()[selected()];
    if (mine !== wanted || !picture) return;
    setStatus("Loading...");
    let tiles: WallTile[];
    try {
      tiles = await request<WallTile[]>({ method: "wallpaper", path: picture.path, fit: !fill() });
    } catch (error) {
      setStatus(String(error).replace(/^Error: /, ""));
      return;
    }
    if (mine !== wanted) return;
    const bridge = (globalThis as { omarchyBridge?: Loader }).omarchyBridge;
    const next = tiles.map((t) => bridge?.loadTexture(t.file, t.w, t.h) ?? -1);
    if (next.some((h) => h < 0) || nodes.some((n) => !n)) {
      for (const h of next) if (h >= 0) getOps().freeTexture?.(h);
      setStatus("The textures did not load");
      return;
    }
    for (const h of handles) getOps().freeTexture?.(h);
    handles = next;
    apply();
    setShown(picture.path);
    setStatus("");
  });
}

function reload() {
  request<Picture[]>({ method: "pictures" }).then((pictures) => {
    const path = list()[selected()]?.path;
    setList(pictures);
    setSelected(Math.max(0, pictures.findIndex((p) => p.path === path)));
    if (pictures.length) show();
    else setStatus("No pictures in ~/Pictures");
  }, (error) => setStatus(String(error)));
}

const CAPTION_H = 18;

function Stage(props: { w: number; h: number }) {
  // the 1024 x 768-pixel picture letterboxed into the window over its caption
  const frameH = () => props.h - CAPTION_H;
  const scale = () => Math.min(props.w / 512, frameH() / 384);
  const ox = () => (props.w - 512 * scale()) / 2;
  const oy = () => (frameH() - 384 * scale()) / 2;
  const tile = (col: number, row: number) => ({ insetL: ox() + col * 256 * scale(), insetT: oy() + row * 256 * scale(), width: 256 * scale(), height: (row ? 128 : 256) * scale() });
  const picture = () => list()[selected()];
  onMount(apply);
  return (
    <View class="absolute left-0 top-0" style={{ width: props.w, height: props.h, bgColor: "#000000" }}>
      <View class="absolute left-0 top-0" style={{ width: props.w, height: frameH(), opacity: shown() ? 1 : 0 }}>
        <Image ref={(n: NodeMirror) => (nodes[0] = n)} class="absolute" style={tile(0, 0)} src="wall-0-0.png" />
        <Image ref={(n: NodeMirror) => (nodes[1] = n)} class="absolute" style={tile(1, 0)} src="wall-1-0.png" />
        <Image ref={(n: NodeMirror) => (nodes[2] = n)} class="absolute" style={tile(0, 1)} src="wall-0-1.png" />
        <Image ref={(n: NodeMirror) => (nodes[3] = n)} class="absolute" style={tile(1, 1)} src="wall-1-1.png" />
      </View>
      <Show when={status()}>
        <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: frameH() / 2 - 8, width: props.w, textColor: color("foreground") }}>{status()}</Text>
      </Show>
      <View class="absolute left-0" style={{ insetT: frameH(), width: props.w, height: CAPTION_H, bgColor: color("background") }}>
        <Text class="absolute left-[8] top-[2] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ width: props.w - 100, textColor: color("foreground"), ...cjk(picture()?.name ?? "", CJK_SLOT_14) }}>
          {picture() ? `${picture()!.group === "Backgrounds" ? "\u{f02e9}" : "\u{f0100}"} ${picture()!.name}` : ""}
        </Text>
        <Text class="absolute right-[8] top-[2] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
          {`${list().length ? selected() + 1 : 0}/${list().length}${fill() ? "  filled" : ""}`}
        </Text>
      </View>
    </View>
  );
}

function setBackground() {
  const picture = list()[selected()];
  if (!picture) return;
  run(`omarchy-theme-bg-set ${quote(picture.path)}`).then(
    (r) => toast({ icon: "\u{f02e9}", title: "Background", body: r.code === 0 ? picture.name : r.stderr.trim().split("\n").pop() ?? "failed", tone: r.code === 0 ? "info" : "error" }),
    () => {},
  );
}

function select(index: number) {
  const next = Math.max(0, Math.min(list().length - 1, index));
  if (next === selected()) return;
  setSelected(next);
  show();
}

function toggleFill() {
  setFill((f) => !f);
  show();
}

register({
  id: "pictures",
  title: "Pictures",
  icon: "\u{f02e9}",
  Stage,
  hint: () => "↑↓ next picture · Enter fills the panel · Tab sets it as the background",
  press(key) {
    if (key & BTN.UP) select(selected() - 1);
    else if (key & BTN.DOWN) select(selected() + 1);
    else if (key & BTN.CIRCLE) toggleFill();
    else if (key & BTN.TRIANGLE) setBackground();
  },
  shown: reload,
  hidden() {
    wanted++;
    release();
  },
});
