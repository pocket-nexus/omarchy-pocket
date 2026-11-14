# Omarchy Pocket

<p align="center"><img src="docs/media/rg-ds-plus.webp" width="560" alt="An RG DS Plus running Omarchy Pocket: a terminal, a CPU panel and a clock tiled on the upper screen, the keyboard deck on the lower"></p>

Omarchy's CLI, themes, config and Linux services on the Anbernic RG DS Plus (RK3568, two 1024×768 DSI panels), under one PocketJS shell rendered by the Mali-G52. Omarchy's desktop session (Hyprland, Quickshell, SDDM) is not installed. The site is [omapocket.org](https://omapocket.org), with a [live demo](https://omapocket.org/demo/) of the shell in the browser.

The picture is the device's three.js model (`site/public/kit/rgds.js`) with two captures from the device on its panels, rendered by `site/render.ts`.

## On the device

<p align="center"><img src="docs/media/screens.webp" width="840" alt="Six captures, each the upper panel over the lower: the desktop with the workspace pad, three tiled windows over the keyboard, Codex in a window, three windows over the window layer's legend, Hacker News and Maps over the touchpad"></p>

Both panels read back from the GPU (`tools/screenshot.ts`), the upper over the lower:

- **Top row:** the desktop with the workspace pad; a terminal, Activity and Clock tiled, over the keyboard deck; Codex in a window.
- **Bottom row:** the window layer's key sheet (hold L1); Hacker News and Maps over the touchpad.

## On the AYN Thor

The AYN Thor (Snapdragon 8 Gen 2, Android 13, a 1920×1080 upper display over a 1240×1080 touch display) runs Omarchy Pocket as an installable Android app: the same shell on both displays at raster density 3 (640×360 points over 413×360), the same host program built as `libomarchy_pocket.so` on the Adreno through EGL, the Odin controller as the gamepad, and Omarchy's CLI with omarchy-pocketd in the RG DS Plus image's Arch Linux ARM root, run by the app under proot. Android stands in for systemd, NetworkManager, PipeWire and BlueZ. [docs/ayn-thor.md](docs/ayn-thor.md) has the details.

**Install on a Thor:** download `omarchy-pocket-<version>.apk` and `omarchy-pocket-root.tar.zst` (802 MB) from the [latest release](https://github.com/pocket-nexus/omarchy-pocket/releases/latest) onto the Thor and install the APK; Android asks once to let the browser or file manager install apps. Open Omarchy Pocket, press START and choose `omarchy-pocket-root.tar.zst`: the app copies it and unpacks the Linux root into its own files. The lock screen's password is `omarchy`. A later release installs over this one and keeps the root.

```sh
bun tools/android.ts all            # the app: lib, proot, daemon, shell, applets, apk, adb install
bun tools/android.ts rootfs         # the Linux root, from the RG DS Plus image
bun tools/android.ts push-rootfs    # the app installs it at its next start
bun tools/android.ts release        # a release's files in dist/android/<version>/, signed with the release key
```

## On the Retroid Pocket Duo Lite

<p align="center"><img src="docs/media/retroid-pocket-duo-lite.webp" width="420" alt="The Duo Lite's two screens: a clock, a terminal and Activity tiled on the upper screen, the keyboard deck on the lower one"></p>

The Retroid Pocket Duo Lite (Snapdragon 665, Android 15, a 5.5" 1920×1080 upper display over a 4.2" 1280×960 touch display) runs the Thor's app: one APK carries both handhelds' profiles, shell packages and applets (11 MB) and chooses by `Build.MODEL`. The stage is the Thor's 640×360 points; the deck is 426×320 points at density 3, the keys 8.5 mm apart; the Retroid Pocket Controller is the gamepad, and the shoulder legend draws the D-pad over the left stick, A B X Y in Nintendo order and SELECT and START at the lower display's upper corners, where they sit. A launcher on the lower display starts the app on the upper one. [docs/retroid-pocket-duo-lite.md](docs/retroid-pocket-duo-lite.md) has the details. 0.2.0's APK carries the Thor's profile only: install a later release, or from source with `ANDROID_SERIAL=<serial> bun tools/android.ts all`.

## On the ClockworkPi uConsole

The ClockworkPi uConsole (Raspberry Pi CM4, Raspberry Pi OS 13) runs Omarchy Pocket beside its own desktop: the same host program built with Mesa (`--features mesa`) on its one 5" panel, the stage turned a quarter onto the 720×1280 portrait panel and taking all of it at 640×360 points (density 2); the keyboard as the keyboard, the trackball as the pointer with L and R as its buttons, the D-pad and A B X Y as the gamepad, and START as SUPER, tapped to latch a layer or held for a chord, with the controls' meanings drawn along the panel's bottom edge right above them. Omarchy's CLI and omarchy-pocketd run in the AYN Thor's Arch Linux ARM root under chroot, on Raspberry Pi OS's NetworkManager, PipeWire, BlueZ and logind. [docs/clockwork-uconsole.md](docs/clockwork-uconsole.md) has the details.

On the uConsole, from the release:

```sh
curl -LO https://github.com/pocket-nexus/omarchy-pocket/releases/download/v0.2.0/omarchy-pocket-uconsole_0.2.0_arm64.deb
sudo apt install ./omarchy-pocket-uconsole_0.2.0_arm64.deb   # downloads Omarchy's root (802 MB)
omarchy-pocket-session on        # off: the Raspberry Pi desktop; boot / desktop: what starts at boot
```

From source: `bun tools/uconsole.ts all <user>@<uconsole>` builds the package and installs it over SSH.

## Applets

<p align="center"><img src="docs/media/applets.webp" width="840" alt="Nine applets on sample data: Weather, Hacker News, GitHub, X, Discord, YouTube, Podcasts, Maps and Home"></p>

The windows' applets come from [pocket-nexus/applets](https://github.com/pocket-nexus/applets), the source Pocket Shell also builds for the 3DS and the Tab5. The pictures are each applet's first screen on its sample data, in the player at [applets.pocket.nexus](https://applets.pocket.nexus/); the Store applet installs them on the device.

## Documentation and layout

- [docs/omarchy-pocket.md](docs/omarchy-pocket.md): boot chain, card layout, system image, device program, session, bridge and daemon, input, power, network, shell.
- [docs/features.md](docs/features.md): Omarchy's desktop features and where each stands in Omarchy Pocket.
- [docs/device.md](docs/device.md): hardware, partitions, boot chain, kernel and GPU stack of the stock firmware.
- [docs/usb-link.md](docs/usb-link.md): SSH and port forwarding from a Mac over the OTG USB port, with measurements.
- [docs/ayn-thor.md](docs/ayn-thor.md): the AYN Thor as an Android app: displays, the shell's geometry, input, the Linux root under proot, Android in place of the system services.
- [docs/retroid-pocket-duo-lite.md](docs/retroid-pocket-duo-lite.md): the Retroid Pocket Duo Lite on the same app: its displays and profile, one APK for both handhelds, its controller and legend, launchers on the lower display, run-time glyphs on the Snapdragon 665.
- [docs/clockwork-uconsole.md](docs/clockwork-uconsole.md): the ClockworkPi uConsole: its controls, START as SUPER, the trackball, the controls row, the turned panel, Omarchy's root under chroot, the session beside Raspberry Pi OS's desktop.
- [docs/hyprland-on-libmali.md](docs/hyprland-on-libmali.md): Omarchy's Hyprland on the stock kernel through libmali (the first approach, kept as a record).

| Path | Contents |
|---|---|
| `shell/` | the PocketJS shell (Solid) |
| `host/` | omarchy-pocket-host, the device program (Rust); `libomarchy_pocket.so` for the Android handhelds (`src/android.rs`, `src/gpu_android.rs`) |
| `android/` | the Android handhelds' app (Java, Gradle), each handheld's host profile (`handhelds/<id>/pocket.host.json`: the AYN Thor's, the Retroid Pocket Duo Lite's) and the Linux root's `start.sh` |
| `uconsole/` | the ClockworkPi uConsole's host profile (`pocket.host.json`), its package's files (`rootfs/`: `omarchy-root`, `omarchy-pocket-session`, the session's units, PAM, polkit, logind, tmpfiles) and maintainer scripts (`debian/`), and the release it installs the root from (`release.json`) |
| `daemon/` | omarchy-pocketd (bridge, `omarchy-shell` socket, terminals, the companion's services) and the `hyprctl`/`uwsm`/`omarchy-pocket-term` shims (Bun) |
| `spotify/` | omarchy-pocket-spotify, the Spotify service's program (Rust, on spotatui's modules) |
| `tools/build.ts`, `tools/deploy.ts`, `tools/screenshot.ts` | build the programs, put them on a device over SSH, read both panels back from the GPU |
| `tools/android.ts` | the Android handhelds' app, each handheld's shell package and applets, the Linux root; `exec` runs a command in the root over adb |
| `tools/uconsole.ts` | the uConsole's host program, shell and applets, the Debian package, installing it and the session over SSH, the release |
| `tools/omarchy-assets.ts` | Omarchy's menu, theme, wallpaper and fonts for the shell, from the pinned rc packages |
| `image/build-root.ts`, `image/install.ts` | the system image and its installer |
| `device/` | files for the Omarchy root (`rootfs/`) and the stock root (`stock/`: boot chooser, rescue USB link) |
| `pkg/omarchy-pocket-headless/` | provides Omarchy's desktop-session dependencies |
| `tools/usb-link/` | `usbmux.py` (device) and `usb-mux.ts` (Mac, Bun + libusb) |
| `experiments/hyprland-libmali/` | the Hyprland spike and the patched Hyprland package |

The PocketJS framework, compiler, Linux drivers and the worker runtime come from `vendor/pocketjs`, a submodule at a commit of pocket-nexus/pocketjs main; the host crate, the shell and the tools import from it, and its tools need Bun 1.4.2. The companion's services (the `https://companion.pocket/<service>/` providers, the owner setup, `Supervised`) come from `vendor/pocket-hub`, a submodule of pocket-nexus/pocket-hub (private) with its own `vendor/pocketjs`: `git submodule update --init vendor/pocket-hub && git -C vendor/pocket-hub submodule update --init vendor/pocketjs`. The applets the shell opens in its windows come from `vendor/applets`, a submodule of [pocket-nexus/applets](https://github.com/pocket-nexus/applets): the same source Pocket Shell builds for the 3DS and the Tab5 ([docs/applets.md](docs/applets.md)). `git submodule update --init vendor/pocketjs vendor/applets` (not recursive: the applets build with this repository's PocketJS), then `bun install --cwd vendor/pocketjs --frozen-lockfile` and `POCKETJS_ROOT=vendor/pocketjs bun vendor/applets/tools/setup.ts`.

Pocket Term's grid and key code come from `vendor/pocket-term`, a submodule (`git submodule update --init vendor/pocket-term`, not recursive); `tools/build.ts daemon` installs the daemon's own dependencies (`daemon/package.json`: the libghostty VT core).

```sh
bun tools/omarchy-assets.ts                    # Omarchy's menu, models, palette, wallpaper, fonts
bun tools/build.ts libs root@<device>          # once: libmali for the linker
bun tools/build.ts all                         # host, shell package, daemon, spotify, applets
bun tools/deploy.ts root@<device>              # install and restart on a running device
bun tools/screenshot.ts root@<device> out.png  # both panels from the GPU
```
