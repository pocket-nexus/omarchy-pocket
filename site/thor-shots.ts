// The AYN Thor's captures for the page: each scene is two readbacks of the
// device's own displays (`adb exec-out screencap -d <display>`), the 1920 ×
// 1080 stage and the 1240 × 1080 deck, kept in the ignored
// .pocket-build/validation/site-thor tree. This writes them to
// public/shots/thor as WebPs, the stage at 1280 × 720 (what the model's panel
// shows), the deck at its own size. A scene may take its deck from another.
//
//   bun site/thor-shots.ts [scene ...]
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";

const V = new URL("../.pocket-build/validation/site-thor/", import.meta.url).pathname;
const OUT = new URL("public/shots/thor/", import.meta.url).pathname;

const SHOTS: Record<string, { top: string; bottom?: string | null }> = {
  home: { top: "home" },
  tile4: { top: "tile4" },
  split: { top: "split" },
  legend: { top: "legend" },
  "legend-move": { top: "legend-move" },
  // the chord beat rests on the chord video's first frame (site/thor-record.ts writes both)
  chords: { top: "chords" },
  tile3: { top: "tile3" },
  heart: { top: "heart" },
  theme: { top: "theme" },
  network: { top: "network" },
};

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let n = 0;
for (const [id, s] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(id)) continue;
  const top = `${V}${s.top}-top.png`, bottom = `${V}${s.bottom ?? s.top}-bottom.png`;
  if (!existsSync(top) || !existsSync(bottom)) { console.log("missing", id); continue; }
  await $`magick ${top} -resize 1280x720 -quality 88 -define webp:method=6 ${OUT + id}-top.webp`.quiet();
  await $`magick ${bottom} -quality 88 -define webp:method=6 ${OUT + id}-bottom.webp`.quiet();
  n++;
}
console.log(n, "Thor captures");
