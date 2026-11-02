# omapocket.org

The landing page and the browser demo, an assets-only Worker (`wrangler.jsonc`).

| Path | Contents |
|---|---|
| `public/` | what deploys: `index.html`, `demo/`, `kit/` (the RG DS Plus as a three.js model, the chord table), `shots/` |
| `demo/` | sources of `public/demo/host.js`: the browser's host program and a stand-in for omarchy-pocketd |
| `vs.ts` | builds `public/vs/iphone-duo/`: the comparison from one table of figures, and the to-scale drawing |
| `study/` | the three directions not chosen, and the first draft of this one; not deployed |

```sh
bun site/preview.ts                # http://127.0.0.1:4205
bun site/build-demo.ts             # the shell, the wasm core, the host, the themes into public/demo (--skip-shell keeps the last compile)
bun site/record.ts                 # the chord video and the panel stills, from the shell in /demo (needs the preview)
bun site/icons.ts                  # the icon family and og-image.png (needs the preview)
bun site/shots.ts                  # device captures from the ignored .pocket-build/validation
bun site/vs.ts                     # the iPhone Duo comparison
cd site && bunx wrangler deploy
```

`/demo` runs the shell's real bundle on PocketJS's core compiled to WebAssembly and shows both surfaces on the 3D model. Everything under the shell is a fixture (`demo/daemon.js`): the terminal is a small script, the panels show sample data, applets are not available.

Static assets answer without byte ranges, which Safari needs for a video URL, so the page fetches `shots/chords.mp4` as a blob.
