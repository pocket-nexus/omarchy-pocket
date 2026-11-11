# omapocket.org

The landing page and the browser demo, an assets-only Worker (`wrangler.jsonc`).

| Path | Contents |
|---|---|
| `public/` | what deploys: `index.html`, `demo/`, `kit/` (the machines as three.js models, `machines.js`, the chord table), `shots/` (`shots/thor/` for the AYN Thor) |
| `demo/` | sources of `public/demo/host.js`: the browser's host program and a stand-in for omarchy-pocketd |
| `vs.ts` | builds `public/vs/iphone-duo/`: the comparison from one table of figures, and the to-scale drawing of the iPhone Duo with its home screen |
| `render.ts` | renders the 3D model with two panel captures through headless Chrome: `public/vs/iphone-duo/rg-ds-plus.webp` (the desktop over the keyboard, face on) and the README's picture (`--pose=-18,-48,118`) |
| `study/` | the three directions not chosen, and the first draft of this one; not deployed |

```sh
bun site/preview.ts                # http://127.0.0.1:4205
bun site/build-demo.ts             # the shell, the wasm core, the host, the themes into public/demo (--skip-shell keeps the last compile)
bun site/record.ts                 # the chord video, the legends under L1 and R1 and the panel stills, from the shell in /demo (needs the preview)
bun site/icons.ts                  # the icon family and og-image.png (needs the preview)
bun site/shots.ts                  # the RG DS Plus's device captures from the ignored .pocket-build/validation
bun site/thor-shots.ts             # the AYN Thor's captures (adb screencap of both displays) into public/shots/thor
bun site/vs.ts                     # the iPhone Duo comparison
bun site/render.ts <top.png> <bottom.png> <out.png> [--pose=yaw,pitch,lid]   # the 3D model with two panel captures, transparent
cd site && bunx wrangler deploy
```

`/demo` runs the shell's real bundle on PocketJS's core compiled to WebAssembly and shows both surfaces on the 3D model. Everything under the shell is a fixture (`demo/daemon.js`): the terminal is a small script, the panels show sample data, applets are not available.

Static assets answer without byte ranges, which Safari needs for a video URL, so the page fetches `shots/chords.mp4` as a blob.

## Machines

The landing page keeps one machine on stage, the one the visitor picks (the hero's picker, the header's chip, or the lineup at the end; `?m=thor` in the URL). `public/kit/machines.js` holds everything that differs: the model, the hour of the day it owns (Dusk for the RG DS Plus, Night for the AYN Thor: the sky at each beat and the room light on the model), its scene per beat, its captures, its applets and its links. Copy that differs between machines carries `data-m`. A new machine is an entry there, a model, and its captures.

The models share one runtime (`kit/rgds.js`: pose, panels, buttons, anchors, the camera's fit at 196 mm of height) and draw their own bodies: `buildRgds` in `kit/rgds.js`, `buildThor` in `kit/thor.js` (measured from AYN's to-scale line drawing of the open front view), with the helpers in `kit/parts.js`. Both stand at one scale.

The Thor's captures are its own displays' readbacks under Omarchy's Nord theme (the night city wallpaper). Its chord video is both displays recorded with `screenrecord` while the chord table plays through `omarchy-shell pocket.input hold`, cut so its tick 0 is the table's. The packages (YouTube, Maps, Hacker News) draw a black window inside Omarchy Pocket on the Thor at the time of writing, so its applets beat shows the shell's own windows.
