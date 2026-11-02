# omapocket.org

The landing page and the browser demo, an assets-only Worker (`wrangler.jsonc`).

| Path | Contents |
|---|---|
| `public/` | what deploys: `index.html`, `demo/`, `kit/` (the RG DS Plus as a three.js model, the chord table), `shots/` |
| `demo/` | sources of `public/demo/host.js`: the browser's host program and a stand-in for omarchy-pocketd |
| `vs.ts` | builds `public/vs/iphone-duo/`: the comparison from one table of figures, and the to-scale drawing of the iPhone Duo with its home screen |
| `render.ts` | renders the 3D model with two panel captures through headless Chrome: `public/vs/iphone-duo/rg-ds-plus.webp` (the desktop over the keyboard, face on) and the README's picture (`--pose=-18,-48,118`) |
| `study/` | the three directions not chosen, and the first draft of this one; not deployed |

```sh
bun site/preview.ts                # http://127.0.0.1:4205
bun site/build-demo.ts             # the shell, the wasm core, the host, the themes into public/demo (--skip-shell keeps the last compile)
bun site/record.ts                 # the chord video and the panel stills, from the shell in /demo (needs the preview)
bun site/icons.ts                  # the icon family and og-image.png (needs the preview)
bun site/shots.ts                  # device captures from the ignored .pocket-build/validation
bun site/vs.ts                     # the iPhone Duo comparison
bun site/render.ts <top.png> <bottom.png> <out.png> [--pose=yaw,pitch,lid]   # the 3D model with two panel captures, transparent
cd site && bunx wrangler deploy
```

`/demo` runs the shell's real bundle on PocketJS's core compiled to WebAssembly and shows both surfaces on the 3D model. Everything under the shell is a fixture (`demo/daemon.js`): the terminal is a small script, the panels show sample data, applets are not available.

Static assets answer without byte ranges, which Safari needs for a video URL, so the page fetches `shots/chords.mp4` as a blob.
