// Device captures for the page: splits each 1024 × 1536 readback (tools/screenshot.ts,
// top panel over bottom panel) into two WebPs. The sources stay in the ignored
// .pocket-build/validation tree. An entry may take its deck from another capture.
// The legends under a held shoulder come from the browser demo (site/record.ts).
// Since the deck became two layouts (keys, and the pad with the workspaces in
// its top row and the pins under it), the decks on the page are the browser
// demo's, the shell's real bundle at the RG DS Plus's 1024 × 768: KEYS is a
// terminal's deck, PAD the pad layout over a window, HOME the pad layout with
// nothing focused. The AYN Thor's are site/thor-shots.ts's.
//
//   bun site/shots.ts
import { $ } from "bun";
import { mkdirSync } from "node:fs";

const V = new URL("../.pocket-build/validation/", import.meta.url).pathname;
const OUT = new URL("public/shots/", import.meta.url).pathname;
const D = "home-restore/device", R = "deck-redesign/device";
// the deck as it is now: a terminal's keys, a touch app's pad, Home with its pins
const KEYS = "deck-r2/site/keys.png", PAD = "deck-r2/site/pad.png", HOME = "deck-r2/site/home.png";

const SHOTS: Record<string, { top: string; bottom?: string | null }> = {
  home: { top: "landing-tour/1/home.png", bottom: HOME },
  agent: { top: `${D}/6-agent.png`, bottom: KEYS },
  split: { top: `${D}/15-keys.png`, bottom: KEYS },
  tile3: { top: `${R}/9-three-windows-clock.png`, bottom: KEYS },
  tile4: { top: `${R}/12-notes-editing.png`, bottom: KEYS },
  pad: { top: `${D}/21-pad.png`, bottom: PAD },
  hnfull: { top: `${D}/48-hn-full.png`, bottom: PAD },
  video: { top: `${D}/38-yt-colour3.png`, bottom: PAD },
  weather: { top: "applets-batch/run2/weather-default.png", bottom: PAD },
  maps: { top: "applets-batch/run1/maps2.png", bottom: PAD },
  podcast: { top: "applets-batch/run2/podcasts-player.png", bottom: PAD },
};

mkdirSync(OUT, { recursive: true });
for (const [id, s] of Object.entries(SHOTS)) {
  const bottom = s.bottom === undefined ? s.top : s.bottom;
  await $`magick ${V + s.top} -crop 1024x768+0+0 +repage -quality 88 -define webp:method=6 ${OUT + id}-top.webp`.quiet();
  if (bottom) await $`magick ${V + bottom} -crop 1024x768+0+768 +repage -quality 88 -define webp:method=6 ${OUT + id}-bottom.webp`.quiet();
  else await $`magick -size 1024x768 xc:black -quality 60 ${OUT + id}-bottom.webp`.quiet();
}
console.log(Object.keys(SHOTS).length, "captures");
