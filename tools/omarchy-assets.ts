#!/usr/bin/env bun
// Omarchy's own menu, theme and wallpaper for the shell, from the Omarchy
// packages the device installs (rc channel, pinned below by file name and
// sha256), so the shell shows exactly what the CLI and config on the device
// describe.
//
//   bun tools/omarchy-assets.ts [--theme tokyo-night]
//
// Writes, all ignored by git:
//   .cache/omarchy/<package>/               the extracted packages
//   shell/src/generated/menu.ts             the omarchy-menu.jsonc tree
//   shell/src/generated/palette.ts          the theme's colors.toml (the starting palette)
//   shell/src/generated/menu-chars.txt      every character the menu draws
//   shell/src/generated/<model>.js          Omarchy's shell models (MODELS) as ES modules
//   shell/src/generated/shell-chars.txt     every character those models hold
//   shell/src/generated/glyph-ink.ts        where each icon's ink sits against its advance
//   shell/src/fonts.json                    Nerd Font + Omarchy glyph fallbacks
//   shell/src/wall-<col>-<row>.png (+@2x)   the theme's first background, 4:3,
//                                         in 256-point tiles (a package image
//                                         is a power of two of at most 512 texels)
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { decodePng } from "../vendor/pocketjs/framework/compiler/pak.ts";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const CACHE = join(ROOT, ".cache", "omarchy");
const SHELL = join(ROOT, "shell", "src");
const GENERATED = join(SHELL, "generated");
const REPO = "https://pkgs.omarchy.org/rc/aarch64";
// themes come from omarchy, the menu and Omarchy's glyph font from
// omarchy-settings, the icon glyphs from the Nerd Font
const PACKAGES = {
  omarchy: { file: "omarchy-4.5.0rc2-1-aarch64.pkg.tar.zst", sha256: "2c1c267f305afa607facf47dce0285712693faa85c124f595b57f333060be8db" },
  settings: { file: "omarchy-settings-4.5.0rc2-1-aarch64.pkg.tar.zst", sha256: "caaae24b707cb1b6be36a73446022b9bebb7713bd4518a6da1f09ee5bf2431c4" },
  font: { file: "ttf-jetbrains-mono-nerd-basic-3.5.1-2-any.pkg.tar.zst", sha256: "c574e6266139fd24f668301d39d9faab386d7041ad3952b3012a2480e09cff0c" },
};
const [WIDTH, HEIGHT] = [512, 384]; // logical size of each panel
// Omarchy Quickshell models the shell runs unchanged, by generated module name
const MODELS = {
  "osd-model": "osd/OsdModel.js",
  "power-model": "panels/power/Model.js",
  "network-model": "panels/network/Model.js",
  "audio-model": "panels/audio/Model.js",
  "bluetooth-model": "panels/bluetooth/Model.js",
  "image-picker-model": "image-picker/ImagePickerModel.js",
};
// QML whose glyphs the shell draws through its own code (the bar indicators)
const GLYPH_SOURCES = ["panels/audio/Panel.qml", "panels/bluetooth/Panel.qml"];

const argv = process.argv.slice(2);
const theme = argv.includes("--theme") ? argv[argv.indexOf("--theme") + 1] : "tokyo-night";

async function fetchPackages(): Promise<Record<keyof typeof PACKAGES, string>> {
  mkdirSync(CACHE, { recursive: true });
  const roots = {} as Record<keyof typeof PACKAGES, string>;
  for (const [name, { file, sha256 }] of Object.entries(PACKAGES) as [keyof typeof PACKAGES, (typeof PACKAGES)["omarchy"]][]) {
    const archive = join(CACHE, file);
    if (!existsSync(archive)) await $`curl --http1.1 --retry 3 -fsSL -o ${archive} ${REPO}/${file}`;
    const actual = new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex");
    if (actual !== sha256) throw new Error(`${file}: sha256 ${actual}, expected ${sha256}`);
    const root = join(CACHE, file.replace(/\.pkg\.tar\.zst$/, ""));
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      await $`bsdtar -xf ${archive} -C ${root}`;
    }
    roots[name] = root;
  }
  return roots;
}

/** JSONC → JSON: drops // and /* comments outside strings and trailing commas. */
function jsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface Entry { icon?: string; label?: string; title?: string; action?: string; target?: string; provider?: string; when?: string; checked?: string; disabled?: string }
interface Item { id: string; icon: string; label: string; title: string; action: string; provider: string; when: string; checked: string; disabled: string; children: Item[] }

/** Dotted ids are the tree: `trigger.share.file` sits under `trigger.share`. */
function menuTree(entries: Record<string, Entry>): Item[] {
  const items = new Map<string, Item>();
  const roots: Item[] = [];
  for (const [id, e] of Object.entries(entries)) {
    const item: Item = {
      id, icon: e.icon ?? "", label: e.label ?? id, title: e.title ?? e.label ?? id,
      action: e.action ?? (e.target ? `xdg-open '${e.target}'` : ""), provider: e.provider ?? "", when: e.when ?? "", checked: e.checked ?? "", disabled: e.disabled ?? "", children: [],
    };
    items.set(id, item);
    const parent = id.includes(".") ? items.get(id.slice(0, id.lastIndexOf("."))) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  return roots;
}

function colors(toml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of toml.split("\n")) {
    const m = /^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

const TILE = 256; // logical points; 512 texels at 2x

async function wallpaper(source: string): Promise<string[]> {
  const tmp = join(CACHE, "wallpaper");
  mkdirSync(tmp, { recursive: true });
  const png = join(tmp, "source.png");
  await $`sips -s format png ${source} --out ${png}`.quiet();
  const names: string[] = [];
  for (const scale of [2, 1]) {
    const [w, h] = [WIDTH * scale, HEIGHT * scale];
    const full = join(tmp, `full@${scale}x.png`);
    // cover: scale the short side to fit, then crop the centre to 4:3
    const [sw, sh] = (await $`sips -g pixelWidth -g pixelHeight ${png}`.text()).match(/\d+/g)!.map(Number).slice(-2) as [number, number];
    const fit = sw / sh > w / h ? ["--resampleHeight", String(h)] : ["--resampleWidth", String(w)];
    await $`sips ${fit} ${png} --out ${full}`.quiet();
    await $`sips -c ${h} ${w} ${full}`.quiet();
    const image = decodePng(new Uint8Array(readFileSync(full)));
    if (image.width !== w || image.height !== h) throw new Error(`${full}: ${image.width}x${image.height}, expected ${w}x${h}`);
    for (let row = 0; row * TILE < HEIGHT; row++) {
      for (let col = 0; col * TILE < WIDTH; col++) {
        const [x, y] = [col * TILE * scale, row * TILE * scale];
        const tw = Math.min(TILE, WIDTH - col * TILE) * scale;
        const th = Math.min(TILE, HEIGHT - row * TILE) * scale;
        const tile = new Uint8Array(tw * th * 4);
        for (let r = 0; r < th; r++) tile.set(image.rgba.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + tw) * 4), r * tw * 4);
        const name = `wall-${col}-${row}`;
        writeFileSync(join(SHELL, scale === 1 ? `${name}.png` : `${name}@2x.png`), encodePNG(tile, tw, th));
        if (scale === 1) names.push(name);
      }
    }
  }
  return names;
}

async function main() {
  const roots = await fetchPackages();
  const share = join(roots.omarchy, "usr", "share", "omarchy");
  const settings = join(roots.settings, "usr", "share", "omarchy");
  mkdirSync(GENERATED, { recursive: true });

  const menuText = readFileSync(join(settings, "default", "omarchy", "omarchy-menu.jsonc"), "utf8");
  const tree = menuTree(jsonc(menuText) as Record<string, Entry>);
  writeFileSync(join(GENERATED, "menu.ts"),
    `// Generated by tools/omarchy-assets.ts from omarchy-menu.jsonc (${PACKAGES.settings.file}).\n` +
    `import type { MenuItem } from "../menu.ts";\nexport const MENU: MenuItem[] = ${JSON.stringify(tree, null, 1)};\n`);
  const chars = new Set<string>();
  const walk = (items: Item[]) => items.forEach(i => { for (const c of i.icon + i.label + i.title) chars.add(c); walk(i.children); });
  walk(tree);
  writeFileSync(join(GENERATED, "menu-chars.txt"), [...chars].join(""));

  // Omarchy's own models, the plain-JS halves of its Quickshell plugins:
  // glyph tables, payload parsing, labels. Each ends in a CommonJS export
  // block, replaced here by an ES export of the same names.
  const glyphs = new Set<string>();
  for (const path of GLYPH_SOURCES) for (const c of readFileSync(join(share, "shell", "plugins", path), "utf8").replace(/[\x00-\x7f]/g, "")) glyphs.add(c);
  for (const [name, path] of Object.entries(MODELS)) {
    const source = readFileSync(join(share, "shell", "plugins", path), "utf8");
    const cut = source.indexOf('if (typeof module !== "undefined")');
    if (cut < 0) throw new Error(`${path}: no CommonJS export block`);
    const names = [...source.slice(cut).matchAll(/^\s*(\w+)\s*:\s*\1\s*,?\s*$/gm)].map((m) => m[1]!);
    if (!names.length) throw new Error(`${path}: no exported names`);
    writeFileSync(join(GENERATED, `${name}.js`),
      `// Generated by tools/omarchy-assets.ts from shell/plugins/${path} (${PACKAGES.omarchy.file}).\n` +
      source.slice(0, cut) + `export { ${names.join(", ")} };\n`);
    // untyped, as Omarchy writes them; the shell's own code types what it passes
    writeFileSync(join(GENERATED, `${name}.d.ts`),
      `// Generated by tools/omarchy-assets.ts.\n` + names.map((n) => `export declare const ${n}: any;\n`).join(""));
    for (const c of source.replace(/[\x00-\x7f]/g, "")) glyphs.add(c);
  }
  writeFileSync(join(GENERATED, "shell-chars.txt"), [...glyphs].join(""));

  const themeDir = join(share, "themes", theme);
  const palette = colors(readFileSync(join(themeDir, "colors.toml"), "utf8"));
  writeFileSync(join(GENERATED, "palette.ts"),
    `// Generated by tools/omarchy-assets.ts from themes/${theme}/colors.toml: the palette the\n` +
    `// shell starts with, until omarchy-pocketd reports the theme Omarchy has set.\n` +
    `export const THEME = ${JSON.stringify(theme)};\nexport const PALETTE: Record<string, string> = ${JSON.stringify(palette, null, 1)};\n`);

  const backgrounds = readdirSync(join(themeDir, "backgrounds")).sort();
  const tiles = await wallpaper(join(themeDir, "backgrounds", backgrounds[0]!));

  const fonts = join(roots.font, "usr", "share", "fonts");
  const nerd = (await $`find ${fonts} -name 'JetBrainsMonoNerdFont-Regular.ttf'`.text()).trim();
  const logo = join(settings, "default", "fonts", "omarchy", "omarchy.ttf");
  for (const f of [nerd, logo]) if (!f || !existsSync(f)) throw new Error(`font not found: ${f}`);
  // a Nerd Font icon is wider than its advance and starts at the advance's
  // left edge: a centred Text draws it right of centre (shell/src/ink.ts)
  const icons = new Set<string>();
  for (const file of [join(GENERATED, "menu-chars.txt"), join(GENERATED, "shell-chars.txt"), join(SHELL, "glyphs.txt")]) {
    for (const ch of readFileSync(file, "utf8")) if (privateUse(ch.codePointAt(0)!)) icons.add(ch);
  }
  const ink = inkOffsets([logo, nerd], icons);
  writeFileSync(join(GENERATED, "glyph-ink.ts"),
    `// Generated by tools/omarchy-assets.ts: how far right of its advance's centre\n` +
    `// each icon's ink centre sits, in em, where that is at least 0.01 em.\n` +
    `export const INK: Record<string, number> = ${JSON.stringify(ink, null, 1)};\n`);
  writeFileSync(join(SHELL, "fonts.json"), JSON.stringify({
    // Omarchy's own glyphs (U+E900 is its logo) before the Nerd Font, which maps a devicon there
    fallback: [relative(SHELL, logo), relative(SHELL, nerd)],
    characterFiles: ["generated/menu-chars.txt", "generated/shell-chars.txt", "glyphs.txt"],
    // Latin-1, general punctuation (… – “ ”), arrows and Braille (TUI graphs) for terminals and Omarchy's messages
    ranges: ["U+00A0-00FF", "U+2010-205E", "U+2190-21FF", "U+2800-28FF"],
  }, null, 2) + "\n");
  console.log(`omarchy-assets: ${theme}, ${tree.length} root menu items, ${chars.size} menu characters, wallpaper ${backgrounds[0]} in ${tiles.length} tiles`);
}

const privateUse = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd);

/** Each character's ink offset from the first face that has it: the centre of
 *  its glyf bounds less half its advance, over units per em. Reads the
 *  TrueType tables directly (cmap format 4 or 12, head, hhea, hmtx, loca, glyf). */
function inkOffsets(faces: string[], chars: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  const parsed = faces.map((path) => {
    const b = readFileSync(path);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tables = new Map<string, number>();
    for (let i = 0, n = view.getUint16(4); i < n; i++) tables.set(b.toString("latin1", 12 + i * 16, 16 + i * 16), view.getUint32(20 + i * 16));
    const at = (tag: string) => {
      const offset = tables.get(tag);
      if (offset === undefined) throw new Error(`${path}: no ${tag} table`);
      return offset;
    };
    const head = at("head"), hhea = at("hhea"), hmtx = at("hmtx"), loca = at("loca"), glyf = at("glyf"), cmap = at("cmap");
    const upm = view.getUint16(head + 18);
    const longLoca = view.getInt16(head + 50) === 1;
    const metrics = view.getUint16(hhea + 34);
    // the best Unicode subtable: format 12 (full range), else format 4 (BMP)
    let table = -1;
    for (let i = 0, n = view.getUint16(cmap + 2); i < n; i++) {
      const offset = cmap + view.getUint32(cmap + 8 + i * 8);
      const format = view.getUint16(offset);
      if (format === 12 || (format === 4 && table < 0)) table = offset;
    }
    const glyphOf = (cp: number): number => {
      if (table < 0) return 0;
      if (view.getUint16(table) === 12) {
        for (let g = 0, n = view.getUint32(table + 12); g < n; g++) {
          const start = view.getUint32(table + 16 + g * 12), end = view.getUint32(table + 20 + g * 12);
          if (cp >= start && cp <= end) return view.getUint32(table + 24 + g * 12) + cp - start;
        }
        return 0;
      }
      if (cp > 0xffff) return 0;
      const segments = view.getUint16(table + 6) / 2;
      const ends = table + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        if (cp > view.getUint16(ends + s * 2)) continue;
        const start = view.getUint16(starts + s * 2);
        if (cp < start) return 0;
        const range = view.getUint16(ranges + s * 2);
        const delta = view.getInt16(deltas + s * 2);
        if (!range) return (cp + delta) & 0xffff;
        const glyph = view.getUint16(ranges + s * 2 + range + (cp - start) * 2);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
      return 0;
    };
    const place = (g: number) => (longLoca ? view.getUint32(loca + g * 4) : view.getUint16(loca + g * 2) * 2);
    return { upm, glyphOf, advance: (g: number) => view.getUint16(hmtx + 4 * Math.min(g, metrics - 1)), bounds: (g: number) => {
      const from = place(g);
      if (place(g + 1) === from) return null;
      return { xMin: view.getInt16(glyf + from + 2), xMax: view.getInt16(glyf + from + 6) };
    } };
  });
  for (const ch of [...chars].sort()) {
    for (const face of parsed) {
      const g = face.glyphOf(ch.codePointAt(0)!);
      if (!g) continue;
      const box = face.bounds(g);
      const offset = box ? ((box.xMin + box.xMax) / 2 - face.advance(g) / 2) / face.upm : 0;
      if (Math.abs(offset) >= 0.01) out[ch] = Math.round(offset * 1000) / 1000;
      break;
    }
  }
  return out;
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
