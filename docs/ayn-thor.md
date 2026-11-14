# Omarchy Pocket on the AYN Thor

The AYN Thor (Snapdragon 8 Gen 2, Android 13) runs Omarchy Pocket as an ordinary Android app: the RG DS Plus's shell on both of its displays, drawn by the same host program built for Android, and Omarchy's CLI, themes and omarchy-pocketd in an Arch Linux ARM root the app runs under proot. Nothing on the device is replaced or rooted. The same app runs on the Retroid Pocket Duo Lite ([retroid-pocket-duo-lite.md](retroid-pocket-duo-lite.md)): it carries each handheld's profile, shell package and applets, and chooses by the device. Lines marked **verified** were checked on a Thor (`kalama`, Android 13, SDK 33) on 2026-11-09.

## Layers

| Layer | Where | What |
|---|---|---|
| App | `android/app/` | Java: the activity on the upper display, a Presentation on the lower one, the controller, the Linux environment's service, Android's state for the daemon; the handheld it runs on (`Handheld.java`) |
| Device program | `host/` as `libomarchy_pocket.so` (`host/src/android.rs`) | the RG DS Plus host's bridge, guest, apps-in-windows, net and media modules; EGL windows from Android (`host/src/gpu_android.rs`) |
| Profile | `android/handhelds/ayn-thor/pocket.host.json` | `ayn-thor`: 640 × 360 points over 413 × 360, raster density 3 |
| Linux root | `tools/android.ts rootfs` | the RG DS Plus image (`image/build-root.ts`) without what only that device uses |
| Daemon | `daemon/` with `daemon/android.ts` | omarchy-pocketd as on the RG DS Plus; Android in place of systemd, logind, NetworkManager, PipeWire and BlueZ |
| Shell | `shell/` | the same package, laid out for the surfaces it is given (`shell/src/screen.ts`) |

## Displays

| | Android display | Pixels | Profile | Surface |
|---|---|---|---|---|
| Upper (6", 120 Hz) | 0, the activity's | 1920 × 1080 | 640 × 360 at density 3 | primary: the stage |
| Lower (3.92", touch) | 4, `FLAG_PRESENTATION` | 1240 × 1080 | 413 × 360 at density 3 | auxiliary: the deck |

The runtime requires an auxiliary display of exactly its logical size times the density, so the lower display's surface is **1239 × 1080**: its SurfaceView is 1239 pixels wide at the display's left edge, with no scaling, and the column left over stays black. Started on the lower display (a launcher there), or moved there with its task, the activity hands over to `Relaunch`, which starts it again on display 0: the activity is `singleTask`, so starting itself would only hand the running instance an intent on the display it is on. The upper display's touch is not used: the activity swallows it.

**Density 3 on both.** The profile's density is an integer shared by both displays. At 3 the stage is 640 × 360 points, close to the RG DS Plus's 512 × 384, so the cards, the bar and the menu keep their sizes; text is 2.5 mm tall at 12 points on the upper display (1.9 mm on the RG DS Plus). The deck's ten keys are 41.3 points (124 pixels, 7.5 mm) apart. The package is 43 MB at density 3 (22.5 MB at density 2): its font atlases are 2.25 times the area. Mostly empty, they deflate to 1.9 MB in the APK, which the app copies out once per install (`Assets.java`).

## Shell geometry

`shell/src/screen.ts` reads the surfaces' logical sizes from `ui.__viewport` and `ui.__auxiliarySurface`, the density from `omarchyBridge.density` (the host sets it from the profile, `host/src/guest.rs`) and the device from `ui.__host` (the profile id), before any module of the package runs. Every layout that assumed 512 × 384 takes them from there; unit tests run without a host and get the RG DS Plus's sizes.

- **Stage:** the window manager's area, the bar, the card (centred: 140 points from each side on the Thor), the OSD (96 points above the bottom), the lock clock (on the stage's middle), the screensaver, the key sheet and the QR sheet (12 points from the sides, 24 from the top).
- **Wallpaper:** the daemon cuts the background to the stage's pixels (`size` in the `wallpaper` request) in tiles of at most 512 texels, padded to a power of two at the right and bottom edges: 4 × 3 tiles on the Thor's 1920 × 1080, 2 × 2 on the RG DS Plus. The shell places each at its texels over the density, inside a frame that clips the padding. The package's own four tiles (4:3) cover the stage, scaled, until the daemon answers.
- **Deck:** the keys are a tenth of the deck's width; the trackpad is the width less two 62-point margins (289 points); the strip's preedit is 106 points; the pad's hint goes on two lines when one is wider than the pad.
- **The pad layout** (`shell/src/deck/strip.tsx`, `shell/src/deck/dock.tsx`): the function row holds the logo, Esc, the workspaces, the layout badge (46 points) and the panels in one row, 26 points a tab with four panels (22 with a touch app's Back arrow); the pins sit along the bottom between Hold and Close (37 × 44-point icons in the trackpad's 289-point width), and the trackpad takes the 289 × 264 points above them. With the keys unfolded the trackpad is 289 × 136.
- **Legend:** the controls' columns sit 84 points in from each side. `XBOX_FACES` (the Thor) draws the faces in Xbox order (Y top, X left, B right, A bottom) and the stick above the D-pad, as on the device; the RG DS Plus keeps Nintendo order. A button keeps its meaning by its label: A confirms on both.

## The app

| Class | Does |
|---|---|
| `MainActivity` | the upper display's SurfaceView (1920 × 1080), immersive; starts the shell's thread and the service; the controller's keys and axes; the volume keys; the Linux environment's status over the stage while it is not running |
| `Handheld` | the handhelds by profile id: each display's surface in pixels; `detect` matches `Build.MODEL`, and on another device the profile whose lower surface fits a presentation display |
| `Relaunch` | no window, a task of its own: starts `MainActivity` on display 0 for an instance that found itself on another display |
| `DeckPresentation` | the lower display's SurfaceView and its touch; `FLAG_NOT_FOCUSABLE`, so the controller's keys stay with the activity |
| `Gamepad` | Android key codes and axes to PocketJS buttons and sticks |
| `LinuxService` | a foreground service: installs the root, then runs proot with `start.sh` and starts it again when it exits (1 s, backing off to 30 s when it keeps failing at once) |
| `Linux` | the root's paths, its installation, its preparation before each start, proot's command line |
| `Device` | `android.json` for the daemon, the daemon's commands, the volume keys' OSD, `sleep` when the screen goes off |

**The icon** is an adaptive icon (`res/mipmap-anydpi-v26/icon.xml`): omapocket.org's mark, the clamshell's two screens with the sunset over the deck, on the site's night, inside the 66 dp circle every launcher mask keeps, with a monochrome layer for Android 13's themed icons and a white silhouette for the notification. 0.2.0 carried a plain vector, which Launcher3's circle mask shrank onto a white disc.

**The shell's thread** (`host/src/android.rs`) is started once per process, as the handheld `Native.start` names (the library carries every handheld's profile, `HANDHELDS` from `host/build.rs`), and outlives the activity, which lends it the two windows. `Native.setSurface` hands a window over and returns once the shell's thread has taken it, so a surface Android destroys is never drawn to afterwards. While a display has no window it renders into a 1 × 1 pbuffer and swaps nothing (`gpu_android.rs`); the boot waits for the upper display's window and up to two seconds for the lower one's. With neither, the shell keeps its timers and the bridge at 10 Hz.

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
- **The daemon's paths.** The shell hands the host files the daemon wrote (wallpaper tiles, glyph atlases, applet packages) by their paths in the root; the host opens them under the root's directory (`guest::host_path`, set by `Native.start`). The other way, an applet's requests name its package by its path in the root (`guest::guest_path`): the daemon reads the services and hosts the package may reach from its manifest there. 0.2.0 sent the host's path, which proot does not show, and the daemon refused every companion service (X, Discord, YouTube, Podcasts, Maps, Home) with "does not declare the … service".
- **Each start** (`Linux.prepare`): `/etc/resolv.conf` from Android's active network (public servers without one, written again when the network changes), the runtime directory, and after an update of the app the daemon, `start.sh`, the shims and the handheld's applets from the APK, so the daemon matches the app whatever root it runs in. The service passes `OMARCHY_POCKET_HANDHELD` (the profile id): `hyprctl monitors` describes that handheld's displays.

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

The daemon hands the app commands as one JSON file each in `$XDG_RUNTIME_DIR/omarchy-pocket/android-commands/`, renamed into place; a FileObserver runs and removes them: `volume`, `mute`, `brightness` (both windows' `screenBrightness`, no permission needed), `settings` (Android's Wi-Fi, Internet, Bluetooth, volume, display or battery panel) and `open` (a URL). The panels (`daemon/panels.ts`) use them: the Sound panel's slider sets the media volume; Bluetooth actions open Android's Bluetooth panel, where Android pairs. The Network panel is not the daemon's here (next section). The daemon watches neither logind nor evdev there: the app sends the shell `sleep` when the screen goes off and handles the volume keys.

Two more shims for Omarchy's scripts, installed by the app in `/usr/local/bin`: `wpctl` (`get-volume`, `set-volume`, `set-mute` on the media volume) and `xdg-open` (a URL opens in Android's browser; anything else goes to `/usr/bin/xdg-open`). `hyprctl monitors` describes the Thor's two displays.

**Verified:** the bar shows the battery charging, the volume and Bluetooth from Android; with no network connected it shows none, and an applet's request fails at DNS (`EAI_AGAIN`) in the daemon.

## Wi-Fi

The Network panel is PocketJS's `system.wifi` ([omarchy-pocket.md](omarchy-pocket.md), System capabilities), the same shell code as on the RG DS Plus. `host/src/android.rs` `AndroidWifi` answers it: `Native.start` hands the program the app's `Wifi` object, and each op is a JNI call on the shell's thread (`status`, `setEnabled`, `scan`, `join`, `connect`, `forget`, `disconnect`, `openSettings`). `Wifi.java` keeps the status JSON, built again on the main thread when a Wi-Fi, network, scan, RSSI, supplicant or location-mode broadcast arrives, so `status` reads a string and never waits on Android.

- **targetSdk 28** (`android/app/build.gradle.kts`): Android answers an app that targets Android 9 with Android 9's WifiManager, which turns the radio on and off, adds and enables networks, lists every saved network and removes the ones the app added. Apps that target Android 10 and later get none of these. The modern path stays in `Wifi.java` behind `legacy` (the system's "add network" dialog with a `WifiNetworkSuggestion`).
- **Location:** Android lists networks only to an app with location access and with location on. The first scan asks for it on the upper screen (`MainActivity.ASK_LOCATION`); until then the panel shows the reason as its error row.
- **Join:** `addNetwork` with WPA2-PSK, SAE when the scan shows an SAE-only network, or no key without a passphrase, then `enableNetwork`. An enterprise (EAP) network opens Android's Wi-Fi panel. A passphrase the network refuses comes back in the supplicant broadcast's `ERROR_AUTHENTICATING`, and the panel shows "Wrong password for <ssid>".
- **Saved networks:** the slots are `getConfiguredNetworks` in Android's order, which lists the networks Android's own settings saved as well (three on the test unit). Connect enables any of them; forget removes the ones this app added, and a network Android's own settings saved opens Android's panel with the reason.
- **System Wi-Fi settings:** a row that opens `Settings.Panel.ACTION_WIFI` over the stage.

**Verified** (2026-11-10, Android 13): the panel lists the scan with signal and lock icons and follows new networks while open; Wi-Fi off and on from the panel (`cmd wifi status`); a scan (`WifiService: startScan uid=10117`); the location prompt on the upper screen; Android's Wi-Fi panel opens over the stage and Back returns to it; a join with a wrong passphrase saves the network (`cmd wifi list-networks`), Android reports `ERROR_AUTH_FAILURE_WRONG_PSWD` and the panel shows the reason; Y forgets it and Android's list is as before. A successful join, the connected row and disconnect were not run (no passphrase for a network in range).

## Applets

`tools/android.ts applets` builds pocket-nexus/applets for each handheld's host contract (a package is admitted on the profile it was compiled for) from a copy of `vendor/applets` in `.cache/android/applets-src` (the submodule stays clean), with two changes for density 3: each contract's primary viewport becomes 640 × 360 (Omarchy Pocket shows an applet's touch surface only), and the kit's 256 × 64-point pinstripes (`ui/art/stripes.svg`) bake from a 170 × 42 raster of the same viewBox, as a package texture is at most 512 texels a side.

| Built | Left out |
|---|---|
| Discord, Hacker News, Home Assistant, Maps, Podcasts, X, YouTube | the Store and Spotify (omarchy-pocket's: the Store installs the RG DS Plus's variants, Spotify's speaker plays into PipeWire); Notes, Photos and Camera (capabilities the profile lacks); GitHub and Weather (4.2 and 4.4 MB paks at density 3, past the applet rules' 3 MiB) |

**Verified:** Hacker News opens from Omarchy's Apps beside a terminal, laid out at density 3, and its request reaches omarchy-pocketd.

## Build and install

Needs the Android SDK and NDK (Homebrew's `android-commandlinetools` places are the defaults), `cargo-ndk`, the `aarch64-linux-android` Rust target, libclang (rquickjs ships no bindings for Android; bindgen writes them against the NDK's headers), zstd and bsdtar. The tools run on Bun 1.4.2 (`vendor/pocketjs/.bun-version`; an older Bun cannot read the lockfiles), after `bun install` in `vendor/pocketjs` and `daemon`, and `POCKETJS_ROOT=../pocketjs bun tools/setup.ts` in `vendor/applets` (it links the applets to PocketJS's packages).

```sh
bun tools/omarchy-assets.ts         # once, as for the RG DS Plus
bun tools/android.ts all            # lib, proot, daemon, shell, applets, apk, install (ANDROID_SERIAL picks the device)
bun tools/android.ts rootfs         # .cache/android/omarchy-pocket-root.tar.zst from .cache/rgds-root.tar.zst
bun tools/android.ts push-rootfs    # the app installs it at its next start
bun tools/android.ts apk --debug && bun tools/android.ts install --debug
bun tools/android.ts exec 'omarchy-shell pocket.window list'   # a command in the root (debug builds: run-as)
```

**Signing.** The release build is signed with the release key when its properties file exists, and with the debug key otherwise; the debug build always takes the debug key. The file is `~/.config/omarchy-pocket/signing.properties`, or the path in `OMARCHY_POCKET_SIGNING`, outside the repository: `storeFile` (relative to the file), `storePassword`, `keyAlias`, `keyPassword`. Android installs an update only over an app signed with the same certificate, so a device with a debug build uninstalls it, and the root with it, before it takes a release. The release certificate's SHA-256 is `b5:57:19:34:62:c8:13:f8:73:c3:02:f9:ae:88:5f:3a:5b:78:1c:2c:87:5e:d1:84:ae:cd:8a:e1:c6:41:7f:5a` (CN=Omarchy Pocket, O=Pocket Nexus, RSA 4096, valid to 2054).

## Releases

`bun tools/android.ts release` runs every step from source (`lib`, `proot`, `daemon`, `shell`, `applets`, `apk`, `rootfs`) and writes `dist/android/<version>/`:

| File | What |
|---|---|
| `omarchy-pocket-<version>.apk` | the app for every handheld (11 MB: the shell packages and applets deflate to a tenth), signed with the release key; the command stops when the APK's certificate is the debug key's |
| `omarchy-pocket-root.tar.zst` | the Linux root |
| `SHA256SUMS` | both files' SHA-256 |

The version is `versionName` in `android/app/build.gradle.kts`; a release raises `versionCode` with it. The files go to a GitHub release tagged `v<version>` (`gh release create v<version> dist/android/<version>/*`), which the app's status band names when no root is installed.

**Without a computer.** The app's status band asks for the root while none is installed; START opens Android's file picker, the app copies the archive it is given and installs it. A later release installs over the app and keeps the root: each start puts that release's daemon, `start.sh`, shims and applets into the root (`Linux.prepare`).

**What the root carries.** `image/build-root.ts` makes the user `omarchy` with the password `omarchy` (root's is `root`) and writes no network, SSH, Tailscale or account state: `/etc/NetworkManager/system-connections` and `/root/.ssh` are empty and the image has no SSH host keys. `pacman-key --init` made the keyring's local master key when the image was built; `rootfs` leaves out its secret half (`private-keys-v1.d`, `openpgp-revocs.d`, `secring.gpg`), so devices do not share one. Signature checks read only the public keyring and the trustdb, which stay.

**Third-party programs in the release.** The APK carries Termux's proot 5.1.107 (GPL-2.0, [termux/proot](https://github.com/termux/proot)), libtalloc 2.5.0 (LGPL-3.0, [talloc.samba.org](https://talloc.samba.org/)) and libandroid-shmem 0.7 (BSD-3-Clause, [termux/libandroid-shmem](https://github.com/termux/libandroid-shmem)), unmodified apart from proot's NEEDED entry; the root is Arch Linux ARM's packages, each with its licence in `/usr/share/licenses`, built from the PKGBUILDs at [archlinuxarm/PKGBUILDs](https://github.com/archlinuxarm/PKGBUILDs) and Arch's [packaging repositories](https://gitlab.archlinux.org/archlinux/packaging/packages), and Omarchy ([basecamp/omarchy](https://github.com/basecamp/omarchy), MIT).

## Limits

- **Sound from the root:** no PipeWire runs in it, so the media plane's `pw-play`, Spotify's speaker and anything a terminal program plays are silent. Android's volume and mute work.
- **Voice input:** proot reaches no microphone; the image's ASR model is left out.
- **Wi-Fi:** a network Android's own settings saved is forgotten in Android's panel, not from Omarchy's. A saved network with a wrong passphrase is forgotten (Y) and joined again.
- **Burn-in protection:** the Thor's own "Burn-in Protection Refresher" (AYN's Odin settings) covers both displays from time to time while they are static, and takes the next input; Android lets an app neither turn it off nor draw over it.
- **Applets:** GitHub and Weather wait for the applet budget or their atlases to fit at density 3.
