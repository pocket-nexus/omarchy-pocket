# Omarchy Pocket on the AYN Thor

The AYN Thor (Snapdragon 8 Gen 2, Android 13) runs Omarchy Pocket as an ordinary Android app: the RG DS Plus's shell on both of its displays, drawn by the same host program built for Android, and Omarchy's CLI, themes and omarchy-pocketd in an Arch Linux ARM root the app runs under proot. Nothing on the device is replaced or rooted. Lines marked **verified** were checked on a Thor (`kalama`, Android 13, SDK 33) on 2026-11-09.

## Layers

| Layer | Where | What |
|---|---|---|
| App | `android/app/` | Java: the activity on the upper display, a Presentation on the lower one, the controller, the Linux environment's service, Android's state for the daemon |
| Device program | `host/` as `libomarchy_pocket.so` (`host/src/android.rs`) | the RG DS Plus host's bridge, guest, apps-in-windows, net and media modules; EGL windows from Android (`host/src/gpu_android.rs`) |
| Profile | `android/pocket.host.json` | `ayn-thor`: 640 × 360 points over 413 × 360, raster density 3 |
| Linux root | `tools/android.ts rootfs` | the RG DS Plus image (`image/build-root.ts`) without what only that device uses |
| Daemon | `daemon/` with `daemon/android.ts` | omarchy-pocketd as on the RG DS Plus; Android in place of systemd, logind, NetworkManager, PipeWire and BlueZ |
| Shell | `shell/` | the same package, laid out for the surfaces it is given (`shell/src/screen.ts`) |

## Displays

| | Android display | Pixels | Profile | Surface |
|---|---|---|---|---|
| Upper (6", 120 Hz) | 0, the activity's | 1920 × 1080 | 640 × 360 at density 3 | primary: the stage |
| Lower (3.92", touch) | 4, `FLAG_PRESENTATION` | 1240 × 1080 | 413 × 360 at density 3 | auxiliary: the deck |

The runtime requires an auxiliary display of exactly its logical size times the density, so the lower display's surface is **1239 × 1080**: its SurfaceView is 1239 pixels wide at the display's left edge, with no scaling, and the column left over stays black. The activity relaunches itself on display 0 when a launcher on the lower display starts it. The upper display's touch is not used: the activity swallows it.

**Density 3 on both.** The profile's density is an integer shared by both displays. At 3 the stage is 640 × 360 points, close to the RG DS Plus's 512 × 384, so the cards, the bar and the menu keep their sizes; text is 2.5 mm tall at 12 points on the upper display (1.9 mm on the RG DS Plus). The deck's ten keys are 41.3 points (124 pixels, 7.5 mm) apart. The package is 43 MB at density 3 (22.5 MB at density 2): its font atlases are 2.25 times the area.

## Shell geometry

`shell/src/screen.ts` reads the surfaces' logical sizes from `ui.__viewport` and `ui.__auxiliarySurface`, the density from `omarchyBridge.density` (the host sets it from the profile, `host/src/guest.rs`) and the device from `ui.__host` (the profile id), before any module of the package runs. Every layout that assumed 512 × 384 takes them from there; unit tests run without a host and get the RG DS Plus's sizes.

- **Stage:** the window manager's area, the bar, the card (centred: 140 points from each side on the Thor), the OSD (96 points above the bottom), the lock clock (on the stage's middle), the screensaver, the key sheet and the QR sheet (12 points from the sides, 24 from the top).
- **Wallpaper:** the daemon cuts the background to the stage's pixels (`size` in the `wallpaper` request) in tiles of at most 512 texels, padded to a power of two at the right and bottom edges: 4 × 3 tiles on the Thor's 1920 × 1080, 2 × 2 on the RG DS Plus. The shell places each at its texels over the density, inside a frame that clips the padding. The package's own four tiles (4:3) cover the stage, scaled, until the daemon answers.
- **Deck:** the keys are a tenth of the deck's width; the trackpad is the width less two 62-point margins (289 points); the strip's preedit is 106 points; the pad's hint goes on two lines when one is wider than the pad.
- **Home** (`shell/src/deck/home.tsx`): the RG DS Plus's columns beside the map (the workspaces and the layout on the left, the panels on the right) leave a 16:9 map at 0.43 on a 413-point deck, half the columns' height. A deck narrower than 480 points lays Home out as Omarchy's bar does: one 36-point row along the top with the workspaces and the layout badge on the left and the panels on the right, the map across the width under it (401 × 226 points, 0.63), and the pins as a row of 52 × 40-point icons on the bottom edge, 6 points in, as the top row is from the strip. The tabs share the row's width with the panels (34 points each with four panels).
- **Legend:** the controls' columns sit 84 points in from each side. `XBOX_FACES` (the Thor) draws the faces in Xbox order (Y top, X left, B right, A bottom) and the stick above the D-pad, as on the device; the RG DS Plus keeps Nintendo order. A button keeps its meaning by its label: A confirms on both.

## The app

| Class | Does |
|---|---|
| `MainActivity` | the upper display's SurfaceView (1920 × 1080), immersive; starts the shell's thread and the service; the controller's keys and axes; the volume keys; the Linux environment's status over the stage while it is not running |
| `DeckPresentation` | the lower display's SurfaceView and its touch; `FLAG_NOT_FOCUSABLE`, so the controller's keys stay with the activity |
| `Gamepad` | Android key codes and axes to PocketJS buttons and sticks |
| `LinuxService` | a foreground service: installs the root, then runs proot with `start.sh` and starts it again when it exits (1 s, backing off to 30 s when it keeps failing at once) |
| `Linux` | the root's paths, its installation, its preparation before each start, proot's command line |
| `Device` | `android.json` for the daemon, the daemon's commands, the volume keys' OSD, `sleep` when the screen goes off |

**The shell's thread** (`host/src/android.rs`) is started once per process and outlives the activity, which lends it the two windows. `Native.setSurface` hands a window over and returns once the shell's thread has taken it, so a surface Android destroys is never drawn to afterwards. While a display has no window it renders into a 1 × 1 pbuffer and swaps nothing (`gpu_android.rs`); the boot waits for the upper display's window and up to two seconds for the lower one's. With neither, the shell keeps its timers and the bridge at 10 Hz.

**Presenting.** The presenter is pipelined: a present first completes the previous frame (the renderer's wait, then the displays' swaps) and then renders its own, whose swap waits for the next present. Presenting on demand, a frame would stay unswapped until the next change, and a window just lent would show the frame before it: nothing. The Android loop completes each present at once (`complete_presentation`), which puts it on the displays in the same tick; the RG DS Plus presents each changed panel twice instead. The swap interval is 0: SurfaceFlinger shows the newest buffer, so the 60 Hz loop never waits on the upper display's 120 Hz vsync.

**Verified:** both displays render on the GPU (`EGL 1.5, GLES 2 renderer on 2 displays`); the app goes to the background (both windows taken), comes back and shows its content again; the screen going off locks the shell, and the password typed on the deck's keys unlocks it.

## Input

The Odin controller (`Vendor_2020_Product_0111.kl`) reaches the activity as Android key codes and joystick axes; `Gamepad.java` maps them by label:

| Android | PocketJS |
|---|---|
| `BUTTON_A` / `B` / `X` / `Y` | CIRCLE / CROSS / TRIANGLE / SQUARE |
| `BUTTON_L1` / `R1` | LTRIGGER / RTRIGGER |
| `BUTTON_L2` / `R2`, or `AXIS_BRAKE` / `AXIS_GAS` past 0.5 | ZL / ZR |
| `BUTTON_SELECT` / `START` | SELECT / START |
| `DPAD_*`, or `AXIS_HAT_X` / `Y` | UP / DOWN / LEFT / RIGHT |
| `AXIS_X` / `Y`, `AXIS_Z` / `RZ` | sticks 0–3, less the device's dead zone |
| `VOLUME_UP` / `DOWN` | the media volume ±5% and Omarchy's OSD (`Device.volumeKey`) |
| `BACK` | consumed: B is the shell's back |

A press and release inside one tick still counts (the input source latches presses). The lower display's contacts go to the shell as contacts on the auxiliary surface, in the view's fraction times the surface's logical size; a contact lifted before a tick reported it is reported for that tick. Home and the app switcher stay Android's.

**Verified** with injected events: SELECT turns the deck's layout; A and the D-pad move through Omarchy's menu and open Hacker News from Apps; a 120 ms press on the deck's keys types `ls` and Return into a terminal; the volume key shows the OSD at 20%.

## The Linux environment

**proot** is Termux's (termux/proot 5.1.107, GPL-2.0) with its libtalloc and libandroid-shmem, from Termux's aarch64 repository, pinned by sha256 (`tools/android.ts proot`). An app that targets SDK 29 or later may not `execve` a file in its data directory, but may run what Android extracts from its APK's `lib/` into the native library directory, so each piece goes in `jniLibs` as `libproot.so`, `libproot-loader.so`, `libtalloc.so` and `libandroid-shmem.so` (with `extractNativeLibs`). proot's NEEDED `libtalloc.so.2` is rewritten in place to `libtalloc.so`; the service sets `LD_LIBRARY_PATH` and `PROOT_LOADER` to that directory. proot maps the root's programs through its loader, which the app may run.

**The root** is the RG DS Plus image less its GPU blob, the host program and its package, its boot and device services, the RG DS Plus's applet builds, voice input's model (proot reaches no microphone), pacman's cache and documentation: 802 MB compressed (941 MB for the image), 60,712 entries. `tools/android.ts push-rootfs` puts it in the app's external files directory (`/sdcard/Android/data/dev.pocketnexus.omarchy/files/`, which adb writes to without a permission); START on the status band opens Android's file picker for one elsewhere. The app unpacks it with `Native.installRoot` (`host/src/android_root.rs`, the `tar` and `zstd` crates) into `files/linux/rootfs`:

- ownership is dropped: every file is the app's uid's, and proot (`-i 1002:1002`) shows the Omarchy user its own files;
- modes keep their permission bits, with the owner's read and write added; setuid and setgid go;
- hard links stay hard links (the app's files take them); a refused one becomes a copy;
- the image's three PAX sparse files (format 1.0: pocket-rime, `/tmp/pocket-rime` and glibc's `locale-archive`) are written whole under their real names; the `tar` crate unpacks them as `GNUSparseFile.0/` directories;
- an entry is confined to the root; device nodes and FIFOs are skipped.

**Verified:** 60,712 entries installed in 5.5 s; pocket-rime and `locale-archive` match the archive's sha256.

**Running it.** The service runs `libproot.so --kill-on-exit -i <uid>:<gid> -r <root> -b /dev -b /proc -b /sys -b <root>/tmp:/dev/shm -w /home/omarchy` with a clean environment (`HOME`, `PATH`, `XDG_RUNTIME_DIR=/run/user/<uid>`, `OMARCHY_POCKET_PLATFORM=android`, `OMARCHY_POCKET_DENSITY=3`) around `bash -l /usr/lib/omarchy-pocket/start.sh` (`android/linux/start.sh`), which puts up a D-Bus session bus, sets Omarchy's theme on the first start (`omarchy-theme-set tokyo-night`; the image leaves it to the first login) and becomes omarchy-pocketd. The Omarchy user is uid 1002 in the image (after ALARM's `alarm` and its builder); the app reads it from the root's `/etc/passwd`.

- **No `--link2symlink`.** proot's emulation of hard links stores them as symbolic links holding absolute host paths; `omarchy-theme-set` builds `next-theme/` with hard links and renames it to `current/`, which left every background a dangling link and the wallpaper failing with ENOENT.
- **The bridge** is the root's `/run/user/<uid>/omarchy-pocket/bridge.sock`; the app keeps a link to it at `files/linux/bridge.sock`, which the host connects to whatever the uid. proot translates the socket's path.
- **The daemon's paths.** The shell hands the host files the daemon wrote (wallpaper tiles, glyph atlases, applet packages) by their paths in the root; the host opens them under the root's directory (`guest::host_path`, set by `Native.start`).
- **Each start** (`Linux.prepare`): `/etc/resolv.conf` from Android's active network (public servers without one, written again when the network changes), the runtime directory, and after an update of the app the daemon, `start.sh`, the shims and the Thor's applets from the APK, so the daemon matches the app whatever root it runs in.

**Verified:** Bun 1.4.3 runs omarchy-pocketd under proot; the shell connects; `omarchy-shell pocket.window open terminal` opens Pocket Term on bash with starship's prompt; `omarchy-shell shell summon omarchy.menu` opens Omarchy's menu; `omarchy-theme-set` runs in 5.1 s; `unix_chkpwd` accepts the image's password and refuses another; the run-time glyph atlases bake at density 3 (slot 21 6.7 MB, slot 22 9.3 MB).

## Android in place of the system services

`daemon/android.ts` is on while `OMARCHY_POCKET_PLATFORM=android`. The app keeps what the bar and the panels show in `$XDG_RUNTIME_DIR/omarchy-pocket/android.json`, written through a partial file at each change (a broadcast receiver and a network callback in `Device.java`), and the daemon reads it into SystemState when it changes:

| SystemState | From |
|---|---|
| `battery` | `ACTION_BATTERY_CHANGED` |
| `network` | the default network's transport; the Wi-Fi name only when Android gives it (apps without location access get `Wi-Fi`) |
| `audio` | the media stream's volume and mute |
| `bluetooth` | the adapter's state |
| power panel's brightness | the system brightness, or what the panel set |

The daemon hands the app commands as one JSON file each in `$XDG_RUNTIME_DIR/omarchy-pocket/android-commands/`, renamed into place; a FileObserver runs and removes them: `volume`, `mute`, `brightness` (both windows' `screenBrightness`, no permission needed), `settings` (Android's Wi-Fi, Internet, Bluetooth, volume, display or battery panel) and `open` (a URL). The panels (`daemon/panels.ts`) use them: the Sound panel's slider sets the media volume; Wi-Fi and Bluetooth actions open Android's panels, where Android lists, joins and pairs (an app lists nearby networks only with location access). The daemon watches neither logind nor evdev there: the app sends the shell `sleep` when the screen goes off and handles the volume keys.

Two more shims for Omarchy's scripts, installed by the app in `/usr/local/bin`: `wpctl` (`get-volume`, `set-volume`, `set-mute` on the media volume) and `xdg-open` (a URL opens in Android's browser; anything else goes to `/usr/bin/xdg-open`). `hyprctl monitors` describes the Thor's two displays.

**Verified:** the bar shows the battery charging, the volume and Bluetooth from Android; with no network connected it shows none, and an applet's request fails at DNS (`EAI_AGAIN`) in the daemon.

## Applets

`tools/android.ts applets` builds pocket-nexus/applets for the Thor's host contract from a copy of `vendor/applets` in `.cache/android/applets-src` (the submodule stays clean), with two changes for density 3: each contract's primary viewport becomes 640 × 360 (Omarchy Pocket shows an applet's touch surface only), and the kit's 256 × 64-point pinstripes (`ui/art/stripes.svg`) bake from a 170 × 42 raster of the same viewBox, as a package texture is at most 512 texels a side.

| Built | Left out |
|---|---|
| Discord, Hacker News, Home Assistant, Maps, Podcasts, X, YouTube | the Store and Spotify (omarchy-pocket's: the Store installs the RG DS Plus's variants, Spotify's speaker plays into PipeWire); Notes, Photos and Camera (capabilities the profile lacks); GitHub and Weather (4.2 and 4.4 MB paks at density 3, past the applet rules' 3 MiB) |

**Verified:** Hacker News opens from Omarchy's Apps beside a terminal, laid out at density 3, and its request reaches omarchy-pocketd.

## Build and install

Needs the Android SDK and NDK (Homebrew's `android-commandlinetools` places are the defaults), `cargo-ndk`, the `aarch64-linux-android` Rust target, libclang (rquickjs ships no bindings for Android; bindgen writes them against the NDK's headers), zstd and bsdtar.

```sh
bun tools/omarchy-assets.ts         # once, as for the RG DS Plus
bun tools/android.ts all            # lib, proot, daemon, shell, applets, apk, install
bun tools/android.ts rootfs         # .cache/android/omarchy-pocket-root.tar.zst from .cache/rgds-root.tar.zst
bun tools/android.ts push-rootfs    # the app installs it at its next start
bun tools/android.ts apk --debug && bun tools/android.ts install --debug
bun tools/android.ts exec 'omarchy-shell pocket.window list'   # a command in the root (debug builds: run-as)
```

The APK is signed with the debug key in both build types, so either replaces the other.

## Limits

- **Sound from the root:** no PipeWire runs in it, so the media plane's `pw-play`, Spotify's speaker and anything a terminal program plays are silent. Android's volume and mute work.
- **Voice input:** proot reaches no microphone; the image's ASR model is left out.
- **Wi-Fi:** the network panel shows the connected network only; joining goes through Android's panel.
- **Burn-in protection:** the Thor's own "Burn-in Protection Refresher" (AYN's Odin settings) covers both displays from time to time while they are static, and takes the next input; Android lets an app neither turn it off nor draw over it.
- **Applets:** GitHub and Weather wait for the applet budget or their atlases to fit at density 3.
