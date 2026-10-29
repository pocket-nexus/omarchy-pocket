// The stage's wallpaper: the package's baked tiles of the build theme's first
// background until omarchy-pocketd has Omarchy's current background as
// textures, then those. Omarchy's `omarchy-theme-bg-set` and theme switches
// reach it as `omarchy-shell background set|transition|...`.
import { Image } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import type { NodeMirror } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import type { WallTile } from "../../../daemon/protocol.ts";
import { serve } from "../system.ts";
import { toast } from "./toasts.tsx";

interface Loader {
  loadTexture(path: string, w: number, h: number): number;
}

const nodes: (NodeMirror | undefined)[] = [];
let handles: number[] = [];
let loading = 0;

async function load(path?: string) {
  const mine = ++loading;
  let tiles: WallTile[];
  try {
    tiles = await request<WallTile[]>({ method: "wallpaper", path });
  } catch (error) {
    toast({ icon: "\u{f015a}", title: "Background", body: String(error), tone: "error" });
    return;
  }
  if (mine !== loading) return;
  const bridge = (globalThis as { omarchyBridge?: Loader }).omarchyBridge;
  const next = tiles.map((t) => bridge?.loadTexture(t.file, t.w, t.h) ?? -1);
  const ops = getOps();
  if (next.some((h) => h < 0) || nodes.some((n) => !n)) {
    for (const h of next) if (h >= 0) ops.freeTexture?.(h);
    return;
  }
  next.forEach((handle, i) => ops.setImage(nodes[i]!.id, handle));
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

/** Four tiles of 256 points (512 texels at density 2); the bottom row is half height. */
export function Wallpaper() {
  return (
    <>
      <Image ref={(n: NodeMirror) => (nodes[0] = n)} class="absolute left-0 top-0 w-[256] h-[256]" src="wall-0-0.png" />
      <Image ref={(n: NodeMirror) => (nodes[1] = n)} class="absolute left-[256] top-0 w-[256] h-[256]" src="wall-1-0.png" />
      <Image ref={(n: NodeMirror) => (nodes[2] = n)} class="absolute left-0 top-[256] w-[256] h-[128]" src="wall-0-1.png" />
      <Image ref={(n: NodeMirror) => (nodes[3] = n)} class="absolute left-[256] top-[256] w-[256] h-[128]" src="wall-1-1.png" />
    </>
  );
}
