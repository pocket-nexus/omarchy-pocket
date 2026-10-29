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
//   shell/src/generated/classes.ts          classes.template.ts in the theme's colours
//   shell/src/generated/menu-chars.txt      every character the menu draws
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
interface Item { id: string; icon: string; label: string; title: string; action: string; provider: string; when: string; children: Item[] }

/** Dotted ids are the tree: `trigger.share.file` sits under `trigger.share`. */
function menuTree(entries: Record<string, Entry>): Item[] {
  const items = new Map<string, Item>();
  const roots: Item[] = [];
  for (const [id, e] of Object.entries(entries)) {
    const item: Item = {
      id, icon: e.icon ?? "", label: e.label ?? id, title: e.title ?? e.label ?? id,
      action: e.action ?? (e.target ? `xdg-open '${e.target}'` : ""), provider: e.provider ?? "", when: e.when ?? "", children: [],
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

  const themeDir = join(share, "themes", theme);
  const palette = colors(readFileSync(join(themeDir, "colors.toml"), "utf8"));
  const template = readFileSync(join(SHELL, "classes.template.ts"), "utf8");
  const missing = new Set<string>();
  const classes = template.replace(/\{(\w+)\}/g, (_, name: string) => palette[name] ?? (missing.add(name), name));
  if (missing.size) throw new Error(`${theme}/colors.toml lacks ${[...missing].join(", ")}`);
  writeFileSync(join(GENERATED, "classes.ts"),
    `// Generated by tools/omarchy-assets.ts from classes.template.ts and themes/${theme}/colors.toml.\n` +
    `export const THEME = ${JSON.stringify(theme)};\n` + classes.replace(/^\/\/.*\n/gm, ""));

  const backgrounds = readdirSync(join(themeDir, "backgrounds")).sort();
  const tiles = await wallpaper(join(themeDir, "backgrounds", backgrounds[0]!));

  const fonts = join(roots.font, "usr", "share", "fonts");
  const nerd = (await $`find ${fonts} -name 'JetBrainsMonoNerdFont-Regular.ttf'`.text()).trim();
  const logo = join(settings, "default", "fonts", "omarchy", "omarchy.ttf");
  for (const f of [nerd, logo]) if (!f || !existsSync(f)) throw new Error(`font not found: ${f}`);
  writeFileSync(join(SHELL, "fonts.json"), JSON.stringify({
    // Omarchy's own glyphs (U+E900 is its logo) before the Nerd Font, which maps a devicon there
    fallback: [relative(SHELL, logo), relative(SHELL, nerd)],
    characterFiles: ["generated/menu-chars.txt"],
  }, null, 2) + "\n");
  console.log(`omarchy-assets: ${theme}, ${tree.length} root menu items, ${chars.size} menu characters, wallpaper ${backgrounds[0]} in ${tiles.length} tiles`);
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
