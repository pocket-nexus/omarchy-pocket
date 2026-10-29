// Run-time glyphs for characters the shell package never baked: CJK first.
// The package's atlases hold what the build saw (menu, models, ASCII, box
// drawing, Braille); a terminal printing 你好, a Wi-Fi network's name or an IME
// candidate needs more. This module keeps every such character it has been
// asked for, bakes them with PocketJS's own font baker (bake-font.ts
// bakeSlot, at the shell's raster density) from a CJK face into spare font
// slots, and writes each atlas to a file the host program loads with the
// spec's loadFontAtlas op. Pocket Term's companion does the same over its
// wire (vendor/pocket-term, host/glyphs.ts).
//
// Baking runs in a separate, niced process (`omarchy-pocketd.js bake`): a
// parsed CJK face and a few thousand rasterized glyphs cost the daemon's event
// loop seconds and over 100 MB, which the baker returns when it exits. Each
// baked set is kept under ~/.cache/omarchy-pocket/glyphs by a hash of its
// characters and face, so a restarted daemon publishes it without baking.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AtlasFile } from "./protocol.ts";

/** Spare slots above the package's baked ones (0..20; MAX_FONT_SLOTS is 24):
 *  21 at 12 px for the terminal's cells, 22 at 14 px for the shell's text-sm. */
export const ATLASES = [
  { slot: 21, px: 12 },
  { slot: 22, px: 14 },
] as const;
const DENSITY = 2;
const DEBOUNCE_MS = 300;
const CACHE_KEEP = 3;
/** Characters every atlas carries, so a mixed line drawn in its slot is whole. */
const BASE = (() => {
  const out: number[] = [];
  for (let cp = 0x20; cp <= 0x7e; cp++) out.push(cp);
  for (const ch of "，。、；：？！“”‘’（）《》【】—…·") out.push(ch.codePointAt(0)!);
  return out;
})();
const FONTS = [
  process.env.OMARCHY_POCKET_CJK_FONT ?? "",
  "/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
];

/** opentype.js reads no TrueType collections; one member is a table copy with
 *  offsets rebased (as vendor/pocket-term host/glyphs.ts extractFromCollection). */
function firstFace(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x74746366) return bytes; // 'ttcf'
  const sfnt = view.getUint32(12);
  const count = view.getUint16(sfnt + 4);
  const records = Array.from({ length: count }, (_, i) => {
    const at = sfnt + 12 + i * 16;
    return { tag: view.getUint32(at), checksum: view.getUint32(at + 4), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  });
  const directory = 12 + count * 16;
  const total = records.reduce((n, r) => n + ((r.length + 3) & ~3), directory);
  const out = new Uint8Array(total);
  const w = new DataView(out.buffer);
  w.setUint32(0, view.getUint32(sfnt));
  for (const o of [4, 6, 8, 10]) w.setUint16(o, view.getUint16(sfnt + o));
  let at = directory;
  records.forEach((r, i) => {
    w.setUint32(12 + i * 16, r.tag);
    w.setUint32(12 + i * 16 + 4, r.checksum);
    w.setUint32(12 + i * 16 + 8, at);
    w.setUint32(12 + i * 16 + 12, r.length);
    out.set(bytes.subarray(r.offset, r.offset + r.length), at);
    at += (r.length + 3) & ~3;
  });
  return out;
}

export class Glyphs {
  private readonly wanted = new Set<number>();
  private baked = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private baking = false;
  private generation = 0;
  private current: AtlasFile[] = [];

  constructor(
    private readonly dir: string,
    private readonly cache: string,
    private readonly published: (atlases: AtlasFile[]) => void,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** The cache entry for a character list: its hash with the face and the slots. */
  private entry(chars: number[]): string {
    const face = FONTS.find((p) => p && existsSync(p)) ?? "";
    const stamp = face ? statSync(face).mtimeMs : 0;
    const key = new Bun.CryptoHasher("md5").update(JSON.stringify([chars, face, stamp, ATLASES, DENSITY])).digest("hex").slice(0, 16);
    return join(this.cache, key);
  }

  private publish(chars: Set<number>, counts: number[]) {
    this.baked = chars;
    const gen = ++this.generation;
    this.current = ATLASES.map(({ slot }, i) => ({ slot, path: join(this.dir, `slot${slot}.atlas`), gen, glyphs: counts[i] ?? 0 }));
    this.published(this.current);
  }

  /** Whether `cp` needs a run-time atlas: not ASCII, not in the package. */
  static needs(cp: number): boolean {
    return cp >= 0x2e80 && !(cp >= 0x2800 && cp <= 0x28ff);
  }

  /** Adds the characters of `text` that need run-time glyphs; true when the
   *  atlases will change. A new set is baked after a short pause. */
  want(text: string): boolean {
    let added = false;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (Glyphs.needs(cp) && !this.wanted.has(cp)) {
        this.wanted.add(cp);
        added = true;
      }
    }
    if (added) this.schedule();
    return added;
  }

  /** The atlases as last written (for a shell that reconnects). */
  atlases(): AtlasFile[] {
    return this.current;
  }

  private schedule() {
    if (!this.timer && !this.baking) this.timer = setTimeout(() => void this.bake(), DEBOUNCE_MS);
  }

  private async bake() {
    this.timer = null;
    if ([...this.wanted].every((cp) => this.baked.has(cp))) return;
    this.baking = true;
    const chars = new Set(this.wanted);
    const list = [...BASE, ...chars].sort((a, b) => a - b);
    const entry = this.entry(list);
    const files = ATLASES.map(({ slot }) => `slot${slot}.atlas`);
    if (files.every((f) => existsSync(join(entry, f))) && existsSync(join(entry, "counts.json"))) {
      for (const f of files) copyFileSync(join(entry, f), join(this.dir, f));
      this.baking = false;
      this.publish(chars, JSON.parse(readFileSync(join(entry, "counts.json"), "utf8")));
    } else {
      const baker = Bun.spawn(["nice", "-n", "10", process.execPath, process.argv[1]!, "bake", this.dir], {
        stdin: new TextEncoder().encode(JSON.stringify(list)),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [out, code] = await Promise.all([new Response(baker.stdout).text(), baker.exited]);
      this.baking = false;
      if (code === 0) {
        const counts = JSON.parse(out) as number[];
        this.store(entry, files, counts);
        this.publish(chars, counts);
      } else console.error(`omarchy-pocketd: glyph baker exited ${code}`);
    }
    // characters that arrived during the bake
    if ([...this.wanted].some((cp) => !this.baked.has(cp))) this.schedule();
  }

  /** Keeps a baked set, and the newest few besides it. */
  private store(entry: string, files: string[], counts: number[]) {
    try {
      mkdirSync(entry, { recursive: true });
      for (const f of files) copyFileSync(join(this.dir, f), join(entry, f));
      writeFileSync(join(entry, "counts.json"), JSON.stringify(counts));
      const entries = readdirSync(this.cache)
        .map((name) => ({ name, at: statSync(join(this.cache, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      for (const old of entries.slice(CACHE_KEEP)) rmSync(join(this.cache, old.name), { recursive: true, force: true });
    } catch (error) {
      console.error(`omarchy-pocketd: caching glyph atlases: ${error}`);
    }
  }
}

/** The baker process: codepoints on stdin, one atlas file per slot, glyph
 *  counts on stdout. Imports opentype.js and bake-font.ts only here. */
export async function bakeMain(dir: string) {
  const { default: opentype } = await import("opentype.js");
  const { bakeSlot } = await import("../vendor/pocketjs/framework/compiler/bake-font.ts");
  const path = FONTS.find((p) => p && existsSync(p));
  if (!path) {
    console.error("omarchy-pocketd: no CJK font; install wqy-microhei");
    process.exit(1);
  }
  const font = opentype.parse(firstFace(new Uint8Array(readFileSync(path))).buffer);
  const chars = JSON.parse(await new Response(Bun.stdin.stream()).text()) as number[];
  const counts = ATLASES.map(({ slot, px }) => {
    const atlas = bakeSlot(font, slot, px, false, chars, DENSITY);
    const file = join(dir, `slot${slot}.atlas`);
    writeFileSync(`${file}.tmp`, atlas.bytes);
    renameSync(`${file}.tmp`, file);
    return atlas.glyphCount;
  });
  console.log(JSON.stringify(counts));
}
