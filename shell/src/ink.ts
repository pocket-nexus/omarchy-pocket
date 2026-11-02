// Icons drawn centred in a box. A Nerd Font icon in JetBrains Mono is wider
// than the 0.6 em advance a centred Text lays out, and its ink starts at the
// advance's left edge, so a centred icon sits right of centre: Home and the
// keyboard by 0.116 em, 2.3 points at text-xl. tools/omarchy-assets.ts
// measures each icon's offset from the fonts (generated/glyph-ink.ts).
import { INK } from "./generated/glyph-ink.ts";

/** How far left of its box's centre to place `glyph` drawn at `px` pixels,
 *  in points, to the half point (one device pixel). */
export const inkShift = (glyph: string, px: number) => Math.round((INK[glyph] ?? 0) * px * 2) / 2;
