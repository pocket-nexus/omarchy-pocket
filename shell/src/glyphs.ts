// Run-time glyphs: omarchy-pocketd bakes the CJK characters the shell draws
// into font slots 21 (12 px) and 22 (14 px) and announces each new atlas; the
// host program loads the file into its slot (omarchyBridge.loadFontAtlas).
// `cjk(text, slot)` asks for a string's characters and returns the style a
// Text needs to draw it from the run-time slot, or nothing when the
// package's own atlas has every character.
import { createSignal } from "solid-js";
import { onEvent, request } from "./bridge.ts";
import type { AtlasFile } from "../../daemon/protocol.ts";

interface Loader {
  loadFontAtlas(path: string): boolean;
}

const [generation, setGeneration] = createSignal(0);
const asked = new Set<string>();

/** Characters past U+2E80 (CJK and the scripts after it) come from the
 *  run-time atlases; Braille is baked. */
export function needsRuntime(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x2e80 && !(cp >= 0x2800 && cp <= 0x28ff)) return true;
  }
  return false;
}

function load(atlases: AtlasFile[]) {
  const bridge = (globalThis as { omarchyBridge?: Loader }).omarchyBridge;
  for (const atlas of atlases) bridge?.loadFontAtlas(atlas.path);
  setGeneration((g) => g + 1);
}

/** The style that draws `text` from run-time `slot`, asking the daemon for
 *  any character it has not baked yet; empty when no run-time glyph is needed. */
export function cjk(text: string, slot: number): { fontSlot?: number } {
  generation();
  if (!needsRuntime(text)) return {};
  if (!asked.has(text)) {
    asked.add(text);
    void request({ method: "glyphs", text });
  }
  return { fontSlot: slot };
}

onEvent((event) => {
  if (event.event === "atlas") load(event.atlases);
  // a new daemon: its atlases, and every string asked for again
  else if (event.event === "hello") {
    asked.clear();
    request<AtlasFile[]>({ method: "atlases" }).then(load, () => {});
  }
});
