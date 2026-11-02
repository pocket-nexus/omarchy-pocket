# Omarchy Pocket

Omarchy's CLI, themes, config and Linux services on the Anbernic RG DS Plus (RK3568, two 1024×768 DSI panels), under one PocketJS shell rendered by the Mali-G52. Omarchy's desktop session (Hyprland, Quickshell, SDDM) is not installed.

- [docs/omarchy-pocket.md](docs/omarchy-pocket.md): boot chain, card layout, system image, device program, session, bridge and daemon, input, power, network, shell.
- [docs/features.md](docs/features.md): Omarchy's desktop features and where each stands in Omarchy Pocket.
- [docs/device.md](docs/device.md): hardware, partitions, boot chain, kernel and GPU stack of the stock firmware.
- [docs/usb-link.md](docs/usb-link.md): SSH and port forwarding from a Mac over the OTG USB port, with measurements.
- [docs/hyprland-on-libmali.md](docs/hyprland-on-libmali.md): Omarchy's Hyprland on the stock kernel through libmali (the first approach, kept as a record).

| Path | Contents |
|---|---|
| `shell/` | the PocketJS shell (Solid) |
| `host/` | omarchy-pocket-host, the device program (Rust) |
| `daemon/` | omarchy-pocketd (bridge, `omarchy-shell` socket, terminals) and the `hyprctl`/`uwsm`/`omarchy-pocket-term` shims (Bun) |
| `tools/build.ts`, `tools/deploy.ts`, `tools/screenshot.ts` | build the three programs, put them on a device over SSH, read both panels back from the GPU |
| `tools/omarchy-assets.ts` | Omarchy's menu, theme, wallpaper and fonts for the shell, from the pinned rc packages |
| `image/build-root.ts`, `image/install.ts` | the system image and its installer |
| `device/` | files for the Omarchy root (`rootfs/`) and the stock root (`stock/`: boot chooser, rescue USB link) |
| `pkg/omarchy-pocket-headless/` | provides Omarchy's desktop-session dependencies |
| `tools/usb-link/` | `usbmux.py` (device) and `usb-mux.ts` (Mac, Bun + libusb) |
| `experiments/hyprland-libmali/` | the Hyprland spike and the patched Hyprland package |

The PocketJS framework, compiler, Linux drivers and the worker runtime come from `vendor/pocketjs`, a submodule at a commit of pocket-nexus/pocketjs main; the host crate, the shell and the tools import from it, and its tools need Bun 1.4.2. The applets the shell opens in its windows come from `vendor/applets`, a submodule of [pocket-nexus/applets](https://github.com/pocket-nexus/applets): the same source Pocket Shell builds for the 3DS and the Tab5 ([docs/applets.md](docs/applets.md)). `git submodule update --init vendor/pocketjs vendor/applets` (not recursive: the applets build with this repository's PocketJS), then `bun install --cwd vendor/pocketjs --frozen-lockfile` and `POCKETJS_ROOT=vendor/pocketjs bun vendor/applets/tools/setup.ts`.

Pocket Term's grid and key code come from `vendor/pocket-term`, a submodule (`git submodule update --init vendor/pocket-term`, not recursive); `tools/build.ts daemon` installs the daemon's own dependencies (`daemon/package.json`: the libghostty VT core).

```sh
bun tools/omarchy-assets.ts                    # Omarchy's menu, models, palette, wallpaper, fonts
bun tools/build.ts libs root@<device>          # once: libmali for the linker
bun tools/build.ts all                         # host, shell package, daemon, applets
bun tools/deploy.ts root@<device>              # install and restart on a running device
bun tools/screenshot.ts root@<device> out.png  # both panels from the GPU
```
