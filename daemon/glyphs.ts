// Run-time glyphs for characters the shell package never baked: CJK first.
// The package's atlases hold what the build saw (menu, models, ASCII, box
// drawing, Braille); a terminal printing 你好, a Wi-Fi network's name or an IME
// candidate needs more. This module keeps every such character it has been
// asked for, bakes them with PocketJS's own font baker (bake-font.ts
// bakeSlot, at the shell's raster density) from a CJK face into spare font
// slots, and writes each atlas to a file the host program loads with the
// spec's loadFontAtlas op. Pocket Term's companion does the same over its
// wire (vendor/pocket-term, host/glyphs.ts).
import opentype from "opentype.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bakeSlot } from "../vendor/pocketjs/framework/compiler/bake-font.ts";
import type { AtlasFile } from "./protocol.ts";

/** Spare slots above the package's baked ones (0..20; MAX_FONT_SLOTS is 24):
 *  21 at 12 px for the terminal's cells, 22 at 14 px for the shell's text-sm. */
export const ATLASES = [
  { slot: 21, px: 12 },
  { slot: 22, px: 14 },
] as const;
const DENSITY = 2;
const DEBOUNCE_MS = 150;
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
  private font: opentype.Font | null | undefined;
  private readonly wanted = new Set<number>();
  private baked = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private current: AtlasFile[] = [];

  constructor(
    private readonly dir: string,
    private readonly published: (atlases: AtlasFile[]) => void,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private face(): opentype.Font | null {
    if (this.font !== undefined) return this.font;
    const path = FONTS.find((p) => p && existsSync(p));
    this.font = path ? opentype.parse(firstFace(new Uint8Array(readFileSync(path))).buffer) : null;
    if (!path) console.error("omarchy-pocketd: no CJK font; install wqy-microhei");
    return this.font;
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
    if (added && !this.timer) this.timer = setTimeout(() => this.bake(), DEBOUNCE_MS);
    return added;
  }

  /** The atlases as last written (for a shell that reconnects). */
  atlases(): AtlasFile[] {
    return this.current;
  }

  private bake() {
    this.timer = null;
    const font = this.face();
    if (!font || [...this.wanted].every((cp) => this.baked.has(cp))) return;
    this.baked = new Set(this.wanted);
    const chars = [...BASE, ...this.baked].sort((a, b) => a - b);
    const gen = ++this.generation;
    this.current = ATLASES.map(({ slot, px }) => {
      const atlas = bakeSlot(font, slot, px, false, chars, DENSITY);
      const path = join(this.dir, `slot${slot}.atlas`);
      writeFileSync(`${path}.tmp`, atlas.bytes);
      renameSync(`${path}.tmp`, path);
      return { slot, path, gen, glyphs: atlas.glyphCount };
    });
    this.published(this.current);
  }
}
