// The stage's wallpaper: the package's baked tiles of the build theme's first
// background until omarchy-pocketd has Omarchy's current background as
// textures, then those. Omarchy's `omarchy-theme-bg-set` and theme switches
// reach it as `omarchy-shell background set|transition|...`.
import { createSignal, For } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import type { NodeMirror } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import type { WallTile } from "../../../daemon/protocol.ts";
import { DENSITY, PANEL, STAGE_H, STAGE_W } from "../screen.ts";
import { serve } from "../system.ts";
import { toast } from "./toasts.tsx";

interface Loader {
  loadTexture(path: string, w: number, h: number): number;
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The daemon cuts the stage's panel into textures of at most 512 texels a
 *  side (4 on the RG DS Plus's 1024 x 768, 12 on the Thor's 1920 x 1080). */
const TILE = 512;
const COUNT = Math.ceil(PANEL[0] / TILE) * Math.ceil(PANEL[1] / TILE);
/** The package's own tiles: the build theme's first background as four
 *  256-point tiles of a 512 x 384 frame, scaled to cover the stage. */
const BAKED_SCALE = Math.max(STAGE_W / 512, STAGE_H / 384);
const BAKED: Placed[] = [
  [0, 0, 256, 256],
  [256, 0, 256, 256],
  [0, 256, 256, 128],
  [256, 256, 256, 128],
].map(([x, y, w, h]) => ({
  x: (STAGE_W - 512 * BAKED_SCALE) / 2 + x! * BAKED_SCALE,
  y: (STAGE_H - 384 * BAKED_SCALE) / 2 + y! * BAKED_SCALE,
  w: w! * BAKED_SCALE,
  h: h! * BAKED_SCALE,
}));
const BAKED_SOURCES = ["wall-0-0.png", "wall-1-0.png", "wall-0-1.png", "wall-1-1.png"];

const nodes: (NodeMirror | undefined)[] = [];
const [placed, setPlaced] = createSignal<Placed[]>(BAKED);
let handles: number[] = [];
let loading = 0;

async function load(path?: string) {
  const mine = ++loading;
  let tiles: WallTile[];
  try {
    tiles = await request<WallTile[]>({ method: "wallpaper", path, size: PANEL });
  } catch (error) {
    toast({ icon: "\u{f015a}", title: "Background", body: String(error), tone: "error" });
    return;
  }
  if (mine !== loading) return;
  const bridge = (globalThis as { omarchyBridge?: Loader }).omarchyBridge;
  const next = tiles.map((t) => bridge?.loadTexture(t.file, t.w, t.h) ?? -1);
  const ops = getOps();
  if (next.some((h) => h < 0) || next.length > COUNT || nodes.slice(0, next.length).some((n) => !n)) {
    for (const h of next) if (h >= 0) ops.freeTexture?.(h);
    return;
  }
  next.forEach((handle, i) => ops.setImage(nodes[i]!.id, handle));
  // texels to points; a tile padded to a power of two runs off the stage's edge
  setPlaced(tiles.map((t) => ({ x: t.x / DENSITY, y: t.y / DENSITY, w: t.w / DENSITY, h: t.h / DENSITY })));
  for (const h of handles) ops.freeTexture?.(h);
  handles = next;
}

/** Shows `path` until restoreWallpaper(): the image picker's preview. */
export const previewWallpaper = (path: string) => void load(path);
/** Back to Omarchy's current background. */
export const restoreWallpaper = () => void load();

const set = (path?: string) => (void load(path), "ok");
serve("background", {
  set,
  setInstant: set,
  refresh: () => set(),
  transition: (_from, path) => set(path),
  themeTransition: (_from, _path, finalPath) => set(finalPath),
  prepare: () => "ok",
  setSuspended: () => "ok",
});

void load();

/** The tiles in a frame the stage's size: the package's four until the
 *  daemon's arrive, then the daemon's. */
export function Wallpaper() {
  const slots = Array.from({ length: Math.max(COUNT, BAKED.length) }, (_, i) => i);
  const style = (i: number) => {
    const p = placed()[i];
    return p ? { insetL: p.x, insetT: p.y, width: p.w, height: p.h, opacity: 1 } : { insetL: 0, insetT: 0, width: 0, height: 0, opacity: 0 };
  };
  return (
    <View class="absolute left-0 top-0 overflow-hidden" style={{ width: STAGE_W, height: STAGE_H }}>
      <For each={slots}>
        {(i) => <Image ref={(n: NodeMirror) => (nodes[i] = n)} class="absolute" style={style(i)} src={BAKED_SOURCES[i] ?? BAKED_SOURCES[0]!} />}
      </For>
    </View>
  );
}
