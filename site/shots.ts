// Device captures for the page: splits each 1024 × 1536 readback (tools/screenshot.ts,
// top panel over bottom panel) into two WebPs. The sources stay in the ignored
// .pocket-build/validation tree. An entry may take its deck from another capture.
//
//   bun site/shots.ts
import { $ } from "bun";
import { mkdirSync } from "node:fs";

const V = new URL("../.pocket-build/validation/", import.meta.url).pathname;
const OUT = new URL("public/shots/", import.meta.url).pathname;
const D = "home-restore/device", R = "deck-redesign/device", KEYS = "landing-tour/1/fastfetch-keys.png";

const SHOTS: Record<string, { top: string; bottom?: string | null }> = {
  home: { top: "landing-tour/1/home.png" },
  agent: { top: `${D}/6-agent.png` },
  split: { top: `${D}/15-keys.png` },
  tile3: { top: `${R}/9-three-windows-clock.png`, bottom: KEYS },
  tile4: { top: `${R}/12-notes-editing.png`, bottom: KEYS },
  legend: { top: `${R}/2-legend-l1.png`, bottom: KEYS },
  pad: { top: `${D}/21-pad.png` },
  hnfull: { top: `${D}/48-hn-full.png` },
  video: { top: `${D}/38-yt-colour3.png` },
  weather: { top: "applets-batch/run2/weather-default.png" },
  maps: { top: "applets-batch/run1/maps2.png" },
  podcast: { top: "applets-batch/run2/podcasts-player.png" },
};

mkdirSync(OUT, { recursive: true });
for (const [id, s] of Object.entries(SHOTS)) {
  const bottom = s.bottom === undefined ? s.top : s.bottom;
  await $`magick ${V + s.top} -crop 1024x768+0+0 +repage -quality 88 -define webp:method=6 ${OUT + id}-top.webp`.quiet();
  if (bottom) await $`magick ${V + bottom} -crop 1024x768+0+768 +repage -quality 88 -define webp:method=6 ${OUT + id}-bottom.webp`.quiet();
  else await $`magick -size 1024x768 xc:black -quality 60 ${OUT + id}-bottom.webp`.quiet();
}
console.log(Object.keys(SHOTS).length, "captures");
