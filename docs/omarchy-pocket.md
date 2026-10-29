# Omarchy Pocket on the RG DS Plus

Omarchy Pocket runs Omarchy's CLI, themes, config and Linux services on Arch Linux ARM, and draws its whole UI with one PocketJS program on the Mali-G52. There is no Hyprland, Quickshell, SDDM or uwsm on the device. Lines marked **verified** were checked on the device on 2026-10-29.

## Layers

| Layer | Where | What |
|---|---|---|
| Boot chain | `device/stock/rgds-init` on the stock rootfs (p6) | busybox PID 1: mounts p7 `omarchy`, pivots the stock root to `/mnt/stock`, execs systemd |
| System | `image/build-root.ts`, `device/rootfs/` | Arch Linux ARM + Omarchy rc packages (CLI, themes, config, services), libmali, the USB link, power and lid handling |
| Device program | `host/` (omarchy-pocket-host) | GBM/EGL/GLES on both DSI panels through libmali, evdev input, one QuickJS realm, the bridge client |
| Daemon | `daemon/` (omarchy-pocketd) | Bun, in the Omarchy user's systemd manager: runs Omarchy's CLI for the shell, serves Omarchy's `omarchy-shell` socket, reports system state |
| Shell | `shell/` | Solid app: stage on the top panel, deck on the bottom panel |

## Boot chain

```
U-Boot (p1) ─▶ kernel in boot (p3), root=PARTUUID=614e0000-0000 ─▶ stock rootfs (p6)
           ─▶ /sbin/init = rgds-init ─▶ mount p7 "omarchy", move /dev, pivot_root, exec systemd
                                     └▶ stock busybox init (rescue: sshd, Wi-Fi, USB link)
```

- The kernel, its command line and the boot partition are the stock ones. Only p6's `/sbin/init` changed; the original stays as `/sbin/init.stock`.
- The kernel matches `root=PARTUUID=614e0000-0000` as a prefix of p6's UUID, so no other partition may carry that prefix (p7 is `ac2ea4f7-…`).
- `rgds-init` boots the stock firmware once when p6 holds `/boot-stock-once` (from Omarchy: `touch /mnt/stock/boot-stock-once`), and after two Omarchy boots in a row that never reached `rgds-boot-ok.service`, which deletes `/mnt/stock/.rgds-boot-tries`. Two power cycles during a hung boot return to the stock firmware.
- Every check (partition present, mountable, systemd executable, `/mnt/stock` present) runs before `pivot_root`; each failure execs the stock init, because PID 1 must not exit and a failed `exec` ends a busybox shell.
- `partx` adds a partition to the running kernel without its GPT name; `PARTNAME=omarchy` appears in `/sys/class/block/*/uevent` from the next boot, which is when `rgds-init` reads it.

**Verified:** `rgds-init: Omarchy from /dev/mmcblk1p7, attempt 1`; systemd reaches `multi-user.target` 11.4 s into userspace; `systemctl is-system-running` = `running` with no failed units.

## Card layout

| # | Name | Content |
|---|---|---|
| p1–p5 | uboot, misc, boot, recovery, backup | stock |
| p6 | rootfs | stock Buildroot root (5 GiB): boot chooser and rescue system |
| p7 | omarchy | ext4, sector 10977280 to the end of the card (9.3 GiB, 2.5 GiB used) |

The stock p7–p11 (ports, vendor, oem, userdata, ROMS) are gone; the rescue boot has no launcher UI. The full stock card is `~/Backups/rg-ds-plus/2026-10-29-stock-sd.img.zst`: a raw `dd` of `/dev/mmcblk1` taken with p7–p11 unmounted, 15 634 268 160 bytes, sha256 `160a0ab9b336e5086bdb7f86b872f700de48ac520a907c5e6f7749ffb04bc852`, checked by decompressing it once. The stock GPT is beside it (`sgdisk --backup` and `sfdisk -d`).

## System image (`image/build-root.ts`)

Built in an arm64 OrbStack container from `ArchLinuxARM-aarch64-latest.tar.gz`, exported as a 781 MiB `tar.zst`:

1. `pacman`: Omarchy's aarch64 template for the **rc** channel. rc carries omarchy 4.5.0rc2, the first release with the aarch64 platform tooling; stable carries 4.0.6. ALARM's kernel and `linux-firmware*` are removed.
2. `headless`: builds `pkg/omarchy-pocket-headless`, which provides `hyprland`, `quickshell`, `uwsm`, `sddm` and `xdg-desktop-portal-hyprland`. `omarchy` depends on all five.
3. `packages`: `omarchy`, `omarchy-settings` and the CLI tools and services Omarchy's install enables, without printing, Docker or the display manager. 390 packages, 2.4 GB.
4. `user`: `omarchy` / `omarchy` (wheel, video, input, audio), root / `root`.
5. `device`: `device/rootfs/`, libmali in `/usr/lib/mali`, `omarchy-pocket-host`, the shell package, omarchy-pocketd and its shims, timezone Asia/Shanghai, enabled units, lingering for the Omarchy user.

`image/install.ts` drives the stock firmware over SSH: `check`, `partition` (refuses without the backup), `extract` (bsdtar from the ALARM chroot with `--xattrs --acls --no-fflags`), `configure` (hostname, empty machine-id, the stock SSH host keys, NetworkManager profiles, firmware, the stock kernel's Wi-Fi and Bluetooth modules), `chooser`, `reboot`.

## Device program (`host/`)

- **GPU only.** libmali's GBM device on `/dev/dri/card0`, one EGL context, one GBM surface and EGL window surface per panel, `pocket-gles2` rendering. A flush makes the panel's surface current (presentation renders every panel before flushing any), swaps, adds the GBM front buffer to KMS once and page-flips; a wait takes the flip event for that CRTC and returns the previous buffer to GBM.
- The program links `libmali.so.1` directly: libmali's `libEGL`/`libGLESv2`/`libgbm` are 5.7 KB wrappers that export none of those symbols.
- `--shot DIR --script …` runs the package on a Mac with the CPU raster renderer, for layout work only.
- `touch /tmp/pocket-shot` on the device reads both panels back with `glReadPixels` into `/tmp/pocket-shot-<panel>.rgba`.

**Demand presentation.** The GBM displays report no buffer identity, so PocketJS's presenter cannot keep damage history for them and redraws both panels on every present. The host draws both lists after each guest turn and presents only when either differs from the last presented frame; otherwise it skips rendering and the page flip. `/tmp/pocket-shot` forces a present (checked twice a second). `OMARCHY_POCKET_TIMING=1` logs mean tick costs every 300 ticks.

**Verified** (idle menu, 2026-10-29): 25 % of a core with a present every tick, 7.2 % with demand presentation and Mali's threads idle. Per tick: guest turn and core tick about 650 µs, draw and compare about 480 µs.

**Verified:** `display: GBM/EGL 1.5, GLES 2 renderer on 2 panels`. With the shell running: process RSS 73 MB (anon 30 MB), the Mali driver's context for the process 2326 pages (9 MB), system `MemAvailable` 759 MB of 953 MB. For comparison, Hyprland 0.56 alone held 305 MB of GPU memory on the same device ([hyprland-on-libmali.md](hyprland-on-libmali.md)).

## Session

`omarchy-pocket.service` runs `omarchy-pocket-host` as the Omarchy user with `PAMName=omarchy-pocket` on `/dev/tty1`. pam_systemd registers it as a `tty` session of class `user` on seat0, and logind makes it the user's display session. That is the position Hyprland holds under Omarchy: processes in the user's systemd manager get the active session's polkit rights.

- The user is in `video` (`/dev/dri/card0`, `/dev/mali0`) and `input` (`/dev/input/event*`); the first open of `card0` makes the program DRM master.
- `omarchy-pocketd.service` is a user unit, enabled for every account that is not a system account (`ConditionUser=!@system`). Lingering starts the user manager, and with it the daemon, at boot. It starts through `bash -lc`, so it has the environment Omarchy's `/etc/profile.d/omarchy.sh` sets.
- `uwsm stop` (Omarchy's logout) ends the shell's session; `Restart=always` starts a new one.

**Verified:** session `tty1` on seat0, `Active=yes`, `Display=` the shell's session. From the daemon's context logind's `CanSuspend`, `CanReboot` and `CanPowerOff` answer `yes`. The Omarchy menu's Lock, Suspend, Logout and Reboot ran on the device from the deck.

## Bridge and daemon

The shell reaches the system only through omarchy-pocketd (`daemon/protocol.ts`, one JSON object per line over `$XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock`):

| Request | Reply |
|---|---|
| `run {command}` | `bash -c command` as the Omarchy user: exit code, last 64 KiB of stdout and stderr |
| `conditions {commands}` | one boolean per command, true where it exits 0, four at a time |
| `state` | `SystemState`: battery (the CW2015 gauge), network (nmcli), audio (wpctl), Bluetooth (bluez over D-Bus), power profile, theme name and colors |
| `answer {call, handled, output}` | the shell's answer to an `omarchy-shell` call |

The daemon pushes `state` events when the state changes (read every 15 s and on `omarchy-shell omarchy.indicators refresh`) and `shell` events for each `omarchy-shell` call.

**`omarchy-shell` works unchanged.** The CLI talks to `$XDG_RUNTIME_DIR/omarchy-shell-<md5("$OMARCHY_PATH/shell\n$WAYLAND_DISPLAY")[:16]>.sock`: arguments joined by U+001F, the request ended by U+001E, the reply `OK␟<output>␞` or `SKIP␞`. omarchy-pocketd listens there, answers `shell ping` itself, and passes every other call to the shell, where modules register targets with `serve(target, methods)` the way Quickshell plugins declare `ShellIpc` targets. An unregistered target or a shell that does not answer within 1.5 s gets `SKIP`, and the CLI reports the target missing. socat shuts its write side after the request, so the listener keeps half-open sockets (Bun needs `allowHalfOpen` and an `end` handler for that).

| Target | Methods | Shell module |
|---|---|---|
| `shell` | `summon`, `toggle` (`omarchy.menu` opens the deck at a menu id), `applyTheme` | `deck/menu-deck.tsx`, `theme.ts` |
| `osd` | `show`, `close`, `state`, `ping` | `stage/osd.tsx`, with Omarchy's `OsdModel.js` |
| `lock` | `lock`, `isLocked`, `status` | `stage/lock.tsx` |
| `pocket.input` | `hold <BUTTON> [frames]`, `tap <x> <y>` | `remote-input.ts`: drives the shell over SSH for testing |

**Notifications.** omarchy-pocketd owns `org.freedesktop.Notifications` on the user's session bus (`daemon/notifications.ts`, dbus-next; its native `usocket` and `x11` modules stay out of the bundle, and it falls back to `net`). `Notify` reads Omarchy's hints (`urgency`, `omarchy-glyph`, `omarchy-exec-argv`, `omarchy-actions`) and libnotify's action pairs; the notice goes to the shell as a `notify` event and closes after 5 s (critical notices stay), with `NotificationClosed` on the bus. The shell's `notifyInvoke` runs the notice's command with `setsid -f` or emits `ActionInvoked`.

**Backgrounds.** `wallpaper {path?}` (`daemon/wallpaper.ts`) scales Omarchy's current background (`~/.local/state/omarchy/current/background`) or a given image to the top panel's 1024 × 768 pixels with `vipsthumbnail --smartcrop=centre`, which shrinks on load as Omarchy's own thumbnails do, and writes four raw RGBA8888 tiles (512 × 512 and 512 × 256) under `$XDG_RUNTIME_DIR/omarchy-pocket/wall/`, keeping the last four backgrounds. The shell calls the host's `omarchyBridge.loadTexture(file, w, h)`, which reads a tile and dispatches `uploadTexture` natively, then `setImage` on the four wallpaper nodes and frees the previous textures: no pixels cross the JSON bridge or the JS heap.

`/usr/local/bin/hyprctl`, `uwsm` and `uwsm-app` are copies of `daemon/shim.ts`, which picks the command by the name it runs under. `hyprctl` answers queries with the two panels and no windows and runs `dispatch exec`; `uwsm stop` ends the session.

## Pocket Term

Terminals live in omarchy-pocketd (`daemon/term.ts`): each session is a PTY from `Bun.Terminal` and a libghostty VT core (`@wterm/ghostty`) as the authority, with Pocket Term's grid and key code (`vendor/pocket-term`, pocket-nexus/pocket-term `9b96712`). The daemon turns each screen row into runs of same-coloured text and sends the rows that changed, at most once per 16 ms; the shell (`shell/src/term/`) keeps one signal per row and draws the runs on the top panel below the bar.

- **80 × 26 cells of 6.4 × 14 points** in the 12 px mono face: JetBrains Mono advances 7.2 points at 12 px, and tracking of −0.8 points brings each glyph to its cell. btop needs 80 × 24.
- The bottom panel holds the session tabs and a US keyboard with keys about 34 × 64 points; Shift, Ctrl and Alt latch for one key. The gamepad sends arrows (D-pad), Enter (A), Backspace (B), Escape (X), Tab (Y), PageUp/PageDown (L1/R1) and latches Ctrl/Alt (L2/R2); Select cycles sessions, Start returns to the menu with the sessions running. From the menu, Select opens a terminal.
- `/etc/xdg/xdg-terminals.list` names `omarchy-pocket-term.desktop`, whose command (`omarchy-pocket-term`, a copy of `daemon/shim.ts`) asks the daemon over the `omarchy-shell` socket (`pocket.term open`) to start the command after `-e` with the caller's environment; the shell shows the new session.
- Glyphs come from the package's baked atlases (ASCII, Latin-1, punctuation, arrows, box drawing, block elements, Braille, the menu's icons) and, for wide characters, from the run-time CJK atlas in slot 21: the daemon marks those cells with the slot, and the shell draws each such character as its own Text on its two columns.

**Run-time glyphs.** `daemon/glyphs.ts` keeps every character past U+2E80 the shell has met (terminal rows, `glyphs {text}` requests), bakes them with ASCII and CJK punctuation from wqy-microhei with PocketJS's `bakeSlot` at raster density 2 into slot 21 (12 px) and slot 22 (14 px), 150 ms after the last new character, and writes each atlas to `$XDG_RUNTIME_DIR/omarchy-pocket/glyphs/`. The `atlas` event names the files; the shell calls the host's `omarchyBridge.loadFontAtlas(path)`, which reads the file and dispatches the spec's `loadFontAtlas` op; the core swaps the slot and relayouts. opentype.js reads no TrueType collections, so the daemon copies the first face out of the `.ttc`. The bundle points `opentype.js` at its UMD build, whose default export `bake-font.ts` imports.

**Verified:** `omarchy-launch-floating-terminal-with-presentation` ran fastfetch in Pocket Term; typing by touch and by the gamepad; btop at 80 × 26 with Braille graphs; sessions survive a shell restart and come back with their screens.

## Applets

An applet is a PocketJS package built for the `rg-ds-plus` profile: `applets/<name>/pocket.json` names an entry anywhere in the repository (Motion Lab's is PocketJS's `apps/motions`, with a 512 × 384 native viewport), and `tools/build.ts applets` compiles each to `.cache/applets/<name>.pocket`, installed to `/usr/share/omarchy-pocket/applets/`. PocketJS's 480 × 272 `integer-fit` apps are not admitted as they are: integer-fit needs an exact multiple of the panel.

The Apps menu lists applets before terminal applications. Activating one calls the host's `omarchyBridge.launch(path)`; after that frame presents, the host shuts the Runtime down, opens the panels again and boots the applet in a fresh Runtime and realm, as PocketJS's launcher switches guests (docs/LAUNCHER.md). An applet runs without the Omarchy bridge. Select and Start held together, or `/tmp/pocket-return` (checked twice a second), switch back to the shell; an applet that fails to boot returns to it too. omarchy-pocketd and its terminal sessions keep running meanwhile, and the shell reconciles them when it reconnects.

## Chinese input

The 中 key on the touch keyboard switches pinyin on (`shell/src/term/ime.ts`). Letters and punctuation build a key transcript in PocketJS's IME key codes (`contracts/spec/ime.ts`); `ime {keys}` evaluates the whole transcript in a fresh Rime session (`daemon/ime.ts` around PocketJS's `tools/ime/rime.ts`, with `rime.c` built against Arch's librime as `/usr/lib/omarchy-pocket/pocket-rime`) and returns preedit, five candidates and any committed text. A key that can commit (Space, a digit, Enter, punctuation) holds later keys until its answer is in, so committed text keeps its order. Password fields bypass composition.

- The pinyin data directory `~/.local/share/omarchy-pocket/ime` gets Luna Pinyin, the essay and PocketJS's `pocket_pinyin` schema, built with `rime_deployer` when the daemon starts the first time (14 s on the RK3568). A transcript answers in about 90 ms.
- The daemon bakes GB2312 level 1 (3,755 characters, from `TextDecoder("gbk")`) into the run-time atlases at start, in a `nice`d baker process (about 40 s once; the daemon stays near 37 MB). Each baked set is cached under `~/.cache/omarchy-pocket/glyphs`; a restarted daemon publishes it in seconds. Characters outside the set are added by small bakes as they appear.
- The host raises the GLES glyph cache to 32 MB (64 pages of 512 × 512): a line of candidates pins pages from a 3,871-glyph atlas, and the default 4 MB (eight pages) made the frame fail.

## Input

Measured on the device, and matching the stock firmware's SDL mapping (`gamecontrollerdb.txt`):

| Physical | evdev | PocketJS button |
|---|---|---|
| A / B / X / Y | 304 / 305 / 306 / 307 | CIRCLE / CROSS / TRIANGLE / SQUARE |
| L1 / R1 | 308 / 309 | LTRIGGER / RTRIGGER |
| L2 / R2 | 314 / 315 | ZL / ZR |
| Select / Start | 310 / 311 | SELECT / START |
| D-pad | ABS_HAT0X / ABS_HAT0Y | UP / DOWN / LEFT / RIGHT |
| Power | 116 on `rk805 pwrkey` | logind |
| Lid close / open | 110 / 111 on `rk805 pwrkey` | `rgds-lid.service` |

A confirms because the framework's focus press is CIRCLE. The Goodix GT1x touch panel (`gt9xx-0`) is routed to the bottom surface. **Verified:** buttons and touch under Omarchy Pocket. On the stock firmware, touch stopped producing events after Weston was stopped; under the Omarchy boot nothing blanks the panel and touch works.

## Power

- Omarchy sets `HandlePowerKey=ignore` (its Quickshell shell handles the key). `90-omarchy-pocket.conf` sets `HandlePowerKey=suspend` and `HandlePowerKeyLongPress=poweroff`.
- Anbernic's `rk805 pwrkey` driver reports the lid hall sensor as KEY_INSERT (close) and KEY_DELETE (open), not as the SW_LID switch logind watches. `rgds-lid.service` suspends on KEY_INSERT.
- `/sys/class/anbernic_misc/` also holds `hallkey`, `lcdoff`, `brightness`, `lcdswap` and `tpctrl`.

**Verified:** `PM: suspend entry (deep)` from the power key and from the lid; after each resume both panels, buttons, touch and Wi-Fi return, and the shell keeps its process (no restart).

## Network

The Wi-Fi driver (`RTL8821CS.ko`, vermagic 6.1.141) and the UART Bluetooth glue (`hci_uart.ko`, `rtk_btusb.ko`) are modules of the stock kernel in the stock rootfs's flat `/lib/modules`. `configure` copies them to `/usr/lib/modules/6.1.141/extra`, runs `depmod` and loads `RTL8821CS` from `modules-load.d`. NetworkManager uses `wpa_supplicant`.

Bluetooth sits on UART1 (`/dev/ttyS1`, DT pinctrl `wireless-bluetooth/uart1-gpios`). `rgds-bluetooth.service` repeats the stock `wifibt-init.sh`: rfkill and `/proc/bluetooth/sleep/btwrite` off and on, `modprobe hci_uart`, then the stock root's statically linked `rtk_hciattach -n -s 115200 /dev/ttyS1 rtk_h5` (copied by `configure`), which loads `rtlbt/rtl8821c_fw`. **Verified:** controller `B4:65:DC:CE:C4:73`, powered, scanning.

## Shell (`shell/`)

`tools/omarchy-assets.ts` takes everything Omarchy-specific from the pinned rc packages (`omarchy`, `omarchy-settings`, `ttf-jetbrains-mono-nerd-basic`, by name and sha256):

- the menu tree from `default/omarchy/omarchy-menu.jsonc` (11 root entries, 211 rows) with each row's `when`, `checked` and `disabled` commands;
- Omarchy's Quickshell models, the plain-JS halves of its plugins (`osd/OsdModel.js`, `panels/{power,network,audio,bluetooth}/Model.js`), as ES modules with untyped declarations: the shell picks glyphs and parses payloads with Omarchy's own code;
- the build theme's `colors.toml` as the starting palette;
- the theme's first background, cropped to 4:3 and cut into 256-point tiles, because a package image is a power of two of at most 512 texels;
- `fonts.json` with Omarchy's glyph font before the JetBrainsMono Nerd Font (the Nerd Font maps a devicon at U+E900, Omarchy's logo), the characters of the menu and the models, Latin-1, general punctuation and arrows.

**Colours are run-time values.** Classes carry layout and type (`classes.ts`); each element takes its colours from the palette through its style (`bgColor`, `textColor`, `borderColor`). The palette follows the theme omarchy-pocketd reports and `omarchy-shell shell applyTheme`, which `omarchy-theme-set` calls.

The stage shows the wallpaper under Omarchy's bar (logo, workspaces 1–5, clock, Bluetooth/network/audio/power indicators from SystemState, in the order of Omarchy's default `shell.json`), the OSD near its bottom edge and notices in its top-right corner. The deck lists the Omarchy menu: D-pad or touch moves, A opens, B goes back, L1/R1 page, Start returns to the root, L2/R2 switch workspace. Opening a level asks the daemon for its rows' conditions: a row with a `when` appears once its command exits 0, a `checked` row shows a check mark, a `disabled` row dims. A row's action runs through the daemon; a nonzero exit shows a notice with the command's last line of output, and the level's conditions are read again. The bottom panel holds one `AuxiliarySurface`: each portal is a flex child of the panel's root, so two portals share its width.
