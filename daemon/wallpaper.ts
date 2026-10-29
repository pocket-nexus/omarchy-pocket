// The stage's wallpaper from Omarchy's current background
// (~/.local/state/omarchy/current/background, which omarchy-theme-bg-set and
// omarchy-theme-set point at). Omarchy's backgrounds are up to 8192 x 4608;
// vipsthumbnail shrinks on load and crops to the top panel's 1024 x 768
// pixels, as Omarchy's own omarchy-menu-images does for its thumbnails. The
// result is cut into the textures the shell can upload (a power of two of at
// most 512 per side): raw RGBA8888 files the host program reads itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WallTile } from "./protocol.ts";

const [W, H] = [1024, 768];
const TILE = 512;
/** backgrounds whose tiles stay in the runtime directory (tmpfs: RAM), for the picker's previews */
const KEEP = 4;

export async function wallpaper(runtime: string, home: string, requested?: string, fit = false): Promise<WallTile[]> {
  const source = realpathSync(requested || join(home, ".local", "state", "omarchy", "current", "background"));
  const stat = statSync(source);
  const key = new Bun.CryptoHasher("md5").update(`${source}\n${stat.mtimeMs}\n${stat.size}\n${fit}`).digest("hex").slice(0, 12);
  const dir = join(runtime, "omarchy-pocket", "wall");
  mkdirSync(dir, { recursive: true });
  const tiles: WallTile[] = [];
  for (let row = 0; row * TILE < H; row++) {
    for (let col = 0; col * TILE < W; col++) {
      const w = Math.min(TILE, W - col * TILE);
      const h = Math.min(TILE, H - row * TILE);
      tiles.push({ file: join(dir, `${key}-${col}-${row}.rgba`), x: col * TILE, y: row * TILE, w, h });
    }
  }
  if (tiles.every((t) => existsSync(t.file))) return tiles;

  const scaled = join(dir, `${key}.v`);
  const raw = join(dir, `${key}.raw`);
  const env = { ...process.env, VIPS_CONCURRENCY: "1", VIPS_WARNING: "0" };
  const crop = fit ? [] : ["--smartcrop=centre"];
  const thumb = Bun.spawn(["vipsthumbnail", source, "--size", `${W}x${H}`, ...crop, "-o", fit ? `${scaled}.fit.v` : scaled], { env, stderr: "pipe" });
  if ((await thumb.exited) !== 0) throw new Error(`vipsthumbnail ${source}: ${(await new Response(thumb.stderr).text()).trim().split("\n").pop()}`);
  if (fit) {
    // the whole picture, centred on black
    const embed = Bun.spawn(["vips", "gravity", `${scaled}.fit.v`, scaled, "centre", String(W), String(H), "--extend", "black"], { env, stderr: "pipe" });
    if ((await embed.exited) !== 0) throw new Error(`vips gravity: ${(await new Response(embed.stderr).text()).trim().split("\n").pop()}`);
    rmSync(`${scaled}.fit.v`, { force: true });
  }
  const save = Bun.spawn(["vips", "rawsave", scaled, raw], { env, stderr: "pipe" });
  if ((await save.exited) !== 0) throw new Error(`vips rawsave: ${(await new Response(save.stderr).text()).trim().split("\n").pop()}`);
  const pixels = readFileSync(raw);
  rmSync(scaled, { force: true });
  rmSync(raw, { force: true });
  const bands = pixels.length / (W * H);
  if (bands !== 3 && bands !== 4) throw new Error(`${source}: ${pixels.length} bytes after scaling, not ${W}x${H}`);

  for (const t of tiles) {
    const out = new Uint8Array(t.w * t.h * 4);
    for (let y = 0; y < t.h; y++) {
      let from = ((t.y + y) * W + t.x) * bands;
      let to = y * t.w * 4;
      for (let x = 0; x < t.w; x++, from += bands, to += 4) {
        out[to] = pixels[from]!;
        out[to + 1] = pixels[from + 1]!;
        out[to + 2] = pixels[from + 2]!;
        out[to + 3] = bands === 4 ? pixels[from + 3]! : 255;
      }
    }
    writeFileSync(t.file, out);
  }

  // keep the newest backgrounds' tiles; a theme switch back reuses them
  const keys = [...new Set(readdirSync(dir).filter((n) => n.endsWith(".rgba")).map((n) => n.split("-")[0]!))];
  const byAge = keys.map((k) => ({ k, at: statSync(join(dir, `${k}-0-0.rgba`)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const { k } of byAge.slice(KEEP)) for (const n of readdirSync(dir)) if (n.startsWith(`${k}-`)) rmSync(join(dir, n), { force: true });
  return tiles;
}
