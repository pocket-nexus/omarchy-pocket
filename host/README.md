# omarchy-pocket-host

The device program: the shell package on both 1024×768 MIPI DSI panels of the Anbernic RG DS Plus, **rendered by the Mali-G52 through Rockchip's libmali (GBM, EGL, GLES 2)**, the gamepad and buttons as buttons, the Goodix panel as touch through evdev, and the Omarchy bridge to omarchy-pocketd. DSI-1 (top) is the primary surface and DSI-2 (bottom) the auxiliary surface, each 512×384 points at raster density 2. It started as pocketjs `programs/rg-ds-plus` and builds against the pocketjs crates in `vendor/pocketjs`.

**The device never renders on the CPU.** `src/gpu.rs` opens `/dev/dri/card0` once, creates libmali's GBM device on it, one EGL context and one GBM surface plus EGL window surface per panel, and renders with `pocket-gles2`. A flush makes that panel's surface current (presentation renders every panel before flushing any), swaps, adds the GBM front buffer to KMS once and page-flips with the legacy API; a wait takes the flip event for that panel's CRTC and returns the previous buffer to GBM. The program links `libmali.so.1` directly: libmali's `libEGL`, `libGLESv2` and `libgbm` are small wrappers that export none of those symbols.

The gamepad (`ANBERNIC-rk3568-keys`) gets its own key table: A (304) is CIRCLE, the framework's focus press; B (305) is CROSS; X/Y are TRIANGLE/SQUARE; L1/R1 (308/309) are LTRIGGER/RTRIGGER; L2/R2 (314/315) are ZL/ZR; Select (310) and Start (311) are SELECT and START. The D-pad is a hat (ABS_HAT0X/ABS_HAT0Y). Touch lands on the lower surface unless `--touch-on-top`.

**The bridge** (`src/bridge.rs`, `src/guest.rs`): a nonblocking Unix socket client to `$XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock` (`--bridge` overrides), newline-delimited JSON, retried once a second while the daemon is away, with lines queued up to 4 MiB. The realm gets `globalThis.omarchyBridge.send(line)`, which only queues; at the start of each tick the lines that arrived go to `globalThis.__omarchyBridgeReceive(lines)`. The realm never waits on the daemon.

`touch /tmp/pocket-shot` on the device (as the shell's user) reads each panel's next presented frame back with `glReadPixels` into `/tmp/pocket-shot-<panel>.rgba` (bottom row first); `tools/screenshot.ts` drives it.

`--shot DIR --script "…"` runs the package on any system without the panels, for layout work: scripted buttons and taps on the lower panel (`tap@x,y`), the CPU raster renderer, no bridge, and two in-memory panels behind the same KMS display type, written to `DIR/<tick>-top.xrgb` and `DIR/<tick>-bottom.xrgb` at each `shot` event. `tools/build.ts shot` stacks them into PNGs.

The profile (`profile.ts`) is compiled into the binary: `build.rs` copies the file named by `POCKETJS_PROFILE_RS`. Cross-compiling needs `cargo-zigbuild`, zig and the device's `libmali.so.1` for the linker, in the directory `OMARCHY_POCKET_GL_LIBS` names:

```sh
bun tools/build.ts libs root@<address>   # libmali from the device into .cache/host/gl-libs
bun tools/build.ts host                  # .cache/host/cargo/aarch64-unknown-linux-gnu/release/omarchy-pocket-host
bun tools/build.ts shot --script "30:shot 40:DOWN 50:shot"
```

`--check` admits the package against the compiled profile without opening devices. Default package: `/usr/share/pocketjs/omarchy-pocket.pocket`.
