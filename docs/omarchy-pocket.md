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

Built in an arm64 OrbStack container from `ArchLinuxARM-aarch64-latest.tar.gz`, exported as an 897 MiB `tar.zst` (2026-10-29, with the daemon, Pocket Term, Rime, wqy-microhei, libvips and the applets):

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

**Demand presentation.** The GBM displays report no buffer identity, so PocketJS's presenter cannot keep damage history for them and redraws both panels on every present. The host draws both lists after each guest turn and presents only when either differs from the last presented frame; otherwise it skips rendering and the page flip. A present that changes one panel's list swaps and flips that panel alone (`gpu::hold`): the other is rendered but keeps the frame it shows. A panel's page flip completes at its next acquire, not inside the present that queued it, so a present costs its rendering and the flip lands while the next tick runs; before this, each present also waited out both panels' flips (7–18 ms each). `/tmp/pocket-shot` forces a present (checked twice a second). `OMARCHY_POCKET_TIMING=1` logs mean tick costs every 300 ticks; `=frames` (or `frames=<ms>`) also logs every tick over 20 ms (or `<ms>`) and each panel's swap and flip wait over 4 ms.

**The GPU's floor.** The Mali-G52's devfreq governor (`simple_ondemand`) samples load every 50 ms and leaves the GPU at 200 MHz through a 200 ms window animation, where a panel takes about 15 ms to render; at 800 MHz it takes about 4. While frames are presented the host raises `min_freq` to the highest frequency, and two seconds without a present lower it again (`gpu::GpuFloor`). `/etc/tmpfiles.d/omarchy-pocket-gpu.conf` gives the video group write access to `min_freq`.

**Verified** (2026-10-29, three windows, a split toggled): the transition presents 14–15 frames at 16–17 ms each, about 1 ms of guest and core work per frame; the first frame of a change costs 10–25 ms of guest work. Each Date getter (`getHours`, `getMinutes`, …) converts the time zone and costs about 0.3 ms in the guest, so the shell reads the civil time once per tick.

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
| `pocket.input` | `hold <BUTTON> [frames]`, `tap <x> <y>`, `drag <x> <y> <x2> <y2> [frames]`, `type <text>` | `remote-input.ts`: drives the shell over SSH for testing |
| `pocket.window` | `open terminal|activity|clock|notes|pictures`, `app <path.pocket> [title] [aux|applet]`, `list`, `focus <n>`, `slow <factor>` | `windows.ts` |
| `pocket.screensaver` | `start`, `stop`, `status` | `stage/screensaver.tsx`; `omarchy-launch-screensaver` calls `start` |

**Notifications.** omarchy-pocketd owns `org.freedesktop.Notifications` on the user's session bus (`daemon/notifications.ts`, dbus-next; its native `usocket` and `x11` modules stay out of the bundle, and it falls back to `net`). `Notify` reads Omarchy's hints (`urgency`, `omarchy-glyph`, `omarchy-exec-argv`, `omarchy-actions`) and libnotify's action pairs; the notice goes to the shell as a `notify` event and closes after 5 s (critical notices stay), with `NotificationClosed` on the bus. The shell's `notifyInvoke` runs the notice's command with `setsid -f` or emits `ActionInvoked`.

**Backgrounds.** `wallpaper {path?}` (`daemon/wallpaper.ts`) scales Omarchy's current background (`~/.local/state/omarchy/current/background`) or a given image to the top panel's 1024 × 768 pixels with `vipsthumbnail --smartcrop=centre`, which shrinks on load as Omarchy's own thumbnails do, and writes four raw RGBA8888 tiles (512 × 512 and 512 × 256) under `$XDG_RUNTIME_DIR/omarchy-pocket/wall/`, keeping the last four backgrounds. The shell calls the host's `omarchyBridge.loadTexture(file, w, h)`, which reads a tile and dispatches `uploadTexture` natively, then `setImage` on the four wallpaper nodes and frees the previous textures: no pixels cross the JSON bridge or the JS heap.

`/usr/local/bin/hyprctl`, `uwsm` and `uwsm-app` are copies of `daemon/shim.ts`, which picks the command by the name it runs under. `hyprctl` answers queries with the two panels and no windows and runs `dispatch exec`; `uwsm stop` ends the session.

## Pocket Term

Terminals live in omarchy-pocketd (`daemon/term.ts`): each session is a PTY from `Bun.Terminal` and a libghostty VT core (`@wterm/ghostty`) as the authority, with Pocket Term's grid and key code (`vendor/pocket-term`, pocket-nexus/pocket-term `9b96712`). The daemon turns each screen row into runs of same-coloured text and sends the rows that changed, at most once per 16 ms; the shell (`shell/src/term/`) keeps one signal per row and draws the runs in the session's window.

- **Cells of 6.4 × 14 points** in the 12 px mono face: JetBrains Mono advances 7.2 points at 12 px, and tracking of −0.8 points brings each glyph to its cell. A session's grid is as many cells as its window holds, at most 80 × 26; `termResize {sid, cols, rows}` resizes the VT core and the PTY (the program gets SIGWINCH) and sends a full snapshot. A window with the whole stage holds 77 × 24, half of it 37 × 24. btop needs 80 × 24, so it wants a fullscreen window (L1 + X).
- The strip's Keys segment (or SELECT) puts the keyboard on the deck's body (`shell/src/term/keyboard.tsx`), laid out as a phone's in landscape: ten keys to a row on a 51 × 46-point pitch (keys 45 × 40) on the bottom edge, a letters layer and two symbol layers (123, #+=), and for a terminal or a note a row of Esc, Tab, Ctrl, Alt and the arrows above them. A key types when its finger lifts, at the key under the finger then; while it is down a character key's preview balloon springs up over it on the core's tracks and follows the finger. Backspace and the arrows repeat after 0.4 s. Shift is one-shot and locks capitals on a second tap; Ctrl and Alt latch for one key, and the chord shows on the preview and on the strip (`sent ^L`: Ctrl+L clears a terminal and types nothing). With no shoulder held, the gamepad sends arrows (D-pad), Enter (A), Backspace (B), Tab (X), Space (Y) and Escape (START). The strip above the keys shows that line and a close button, which ends the session.
- `/etc/xdg/xdg-terminals.list` names `omarchy-pocket-term.desktop`, whose command (`omarchy-pocket-term`, a copy of `daemon/shim.ts`) asks the daemon over the `omarchy-shell` socket (`pocket.term open`) to start the command after `-e` with the caller's environment; the shell shows the new session.
- Glyphs come from the package's baked atlases (ASCII, Latin-1, punctuation, arrows, box drawing, block elements, Braille, the menu's icons) and, for wide characters, from the run-time CJK atlas in slot 21: the daemon marks those cells with the slot, and the shell draws each such character as its own Text on its two columns.

**Run-time glyphs.** `daemon/glyphs.ts` keeps every character outside the package's baked ranges the shell has met (terminal rows, `glyphs {text}` requests): CJK, Latin Extended, Greek, Cyrillic, and the Nerd Font's icons in the Private Use Area that prompts draw. It bakes them with ASCII and CJK punctuation from JetBrainsMono Nerd Font, with wqy-microhei for what that face lacks, with PocketJS's `bakeSlot` at raster density 2 into slot 21 (12 px) and slot 22 (14 px), 300 ms after the last new character, and writes each atlas to `$XDG_RUNTIME_DIR/omarchy-pocket/glyphs/`. The `atlas` event names the files; the shell calls the host's `omarchyBridge.loadFontAtlas(path)`, which reads the file and dispatches the spec's `loadFontAtlas` op; the core swaps the slot and relayouts, and the host presents the next frame though its draw lists are unchanged (demand presentation would otherwise keep showing the boxes). At start the daemon publishes the newest set it cached, so starship's `❯` draws from the first prompt. Emoji that command-line tools print are drawn as the Nerd Font icon for the same thing (`EMOJI_ICONS` in `daemon/protocol.ts`): no face on the device has emoji outlines. opentype.js reads no TrueType collections, so the daemon copies the first face out of the `.ttc`. The bundle points `opentype.js` at its UMD build, whose default export `bake-font.ts` imports.

**Verified:** `omarchy-launch-floating-terminal-with-presentation` ran fastfetch in Pocket Term; typing by touch and by the gamepad; btop at 80 × 26 with Braille graphs; sessions survive a shell restart and come back with their screens.

## Windows and chords

The interaction is Pocket Shell's on the 3DS (pocket-nexus/pocket-shell, `shells/3ds` at `f6fec48`), on this device's buttons and panels.

**Layouts.** `shell/src/wm.ts` (no Solid in it; `shell/test/wm.test.ts`) keeps two layouts per workspace, as Omarchy configures Hyprland. Dwindle is a binary split tree: a new window splits the focused one along its longer side and takes the right or bottom half (`force_split = 2`), a split keeps its direction when a window closes (`preserve_split`), and resizing moves the nearest split's ratio within 0.15–0.85. Scrolling is a strip of columns wider than the panel: a new window opens as a column after the focused one at 0.49 of the workspace width, the strip scrolls to keep the focused column whole, and a column can hold a stack. Toggling keeps window order and focus. The tiled area leaves the bar free (18 points, at the top or bottom as shell.json says, none with bar-off), with Omarchy's gaps at the panel's scale: 6 points around the area, windows inset 3, so neighbours sit 6 apart. A window carries a 2-point border (the theme's accent when focused, its muted colour otherwise) and a 16-point title header.

**Chords.** The gamepad is the window manager's keyboard, as Omarchy binds every window action to SUPER and one key (`shell/src/chords.ts`):

| Held | Layer | D-pad | A | B | X | Y | START | SELECT | L2 / R2 |
|---|---|---|---|---|---|---|---|---|---|
| L1 | window | focus | menu | close | fullscreen | toggle split (dwindle), column width (scrolling) | layout | key sheet | shrink / grow |
| R1 | move | swap | another of this | reopen closed | maximize | swap split (dwindle), stack / unstack (scrolling) | next background | toggle bar | pan the strip |
| L1 + R1 | workspace | ← → switch, ↑ ↓ carry the window | | | | | | | |
| none | plain | to the window | to the window | to the window | to the window | to the window | to the window | keyboard or controls | switch workspace |

L2/R2 under a shoulder do what the 3DS's circle pad does. With no shoulder held, a terminal takes the D-pad as arrows, A Enter, B Backspace, X Tab, Y Space and START Escape. The dispatcher, the deck's chord card and the key sheet read the same table, so a label cannot describe what its button does not do. Something that cannot happen says why in a notice ("No window that way", "A split needs two windows").

**Motion.** A window is laid out at its placement, and its transform animates (`shell/src/workspaces.ts`, FLIP; `shell/src/motion.ts` holds the shared helpers). Every change goes through `act`, which compares the current workspace before and after: a window that stays gets its translate and scale set so it appears where it was drawn, and the core eases them back over 200 ms on its `out` curve; a window that arrives pops in from 87 % while it fades up (Omarchy's `windowsIn … popin 87%`); a window that leaves is replaced by its outline, which shrinks to 87 % and fades in 170 ms on a linear curve (`windowsOut`); switching workspaces slides the arriving windows 48 points in from the side the workspace lies on. The script runs once per change; no frame of a transition relayouts the tree. An interrupted transition starts again from where the window is drawn: the store replays the `out` curve (1 − (1 − t)³). `omarchy-shell pocket.window slow <factor>` stretches every transition to watch or film it.

**The deck** (`shell/src/deck/`) is a touch surface in three bands:

**The stage is a screen on the wall.** The top panel takes no touch; everything on it is worked from the gamepad or from the deck, which is the stage's remote, after Pocket Shell's iPod touch remote. The deck repeats nothing the stage's bar shows.

- **The strip** (26 points): the L1 pill, the mode switch and the R1 pill. The switch's three segments are the body's modes: **Windows** (the map), the focused window's remote, named after the window (an applet's touchpad; for a terminal, what drives the program in it: a pad that sends the arrows as a finger travels and Enter on a tap, and ^C, ^D, ^Z, ^R, ^L, Tab, Esc and q as keys, `shell/src/deck/term-remote.tsx`; a shell applet's own controls), and **Keys** (the keyboard, which types into a window that takes keys). The lit segment is the body that shows, and its highlight glides between segments. A pill latches its layer for one chord; both latched are the workspace layer.
- **The body** (318 points) shows the mode the switch names, except while the chord card is up (a layer in force) or a card is up on the stage, when it shows the card's remote (`shell/src/deck/remote.tsx`): a pad that steps the card's selection a row for each 26 points a finger travels and opens on a tap, a rail showing where the selection is, and the card's own buttons (Open, Back, Close; a panel's Select, Less, More, Close, with Forget for Network and Bluetooth; the proxy's Test, Previous, Next, Close; the picker's Apply, Cancel).
- **The dock** (40 points) is the launch bar: the menu, then Terminal, Notes, Activity, Pictures and Clock (a tap opens the window beside the focused one, or focuses it where it is; Terminal always opens a new session), then the applets X, Discord, YouTube and Hacker News (one window each, focused when it is open). The pressed cell fills with the accent and names itself above the dock; an accent mark sits under the focused window's app and a short grey one under an app with a window elsewhere; the menu cell draws in the accent while the menu is up. The key sheet stays on L1 + SELECT and the bar's switch on R1 + SELECT.

**The card.** Omarchy's menu (L1 + A, the dock's first cell, `omarchy-shell shell summon omarchy.menu`), the panels and the theme picker open over the windows in one 360 × 296 card centred under the bar, as Omarchy's launcher opens over a desktop; the stage dims behind it, and the card fades and lifts in over 150 ms (`shell/src/stage/card.tsx`). While a card is up the D-pad and A/B are the card's.

**The touchpad** (`shell/src/deck/touchpad.tsx`, `shell/src/stage/pointer.tsx`) is a focused applet's remote. A finger moves the pointer on the stage, relative and accelerated (1.1 to 3.2 stage points per deck point with speed); a tap clicks where the pointer is: a card's row, a workspace number or indicator in the bar, a window (focus), and on an applet's window a touch on its surface at that point. Two fingers, or the Hold key and a finger, hold that touch down while the pointer moves, which scrolls an applet's lists. Only the finger that moves the pointer clicks, and a second finger counts after five frames at least 40 points from the first: the Goodix panel reports brief contacts near a finger's last position, which were taken for second fingers.

**The map** has the workspace tabs and the layout badge in a column on its left (tap a tab to switch; drop a dragged tile on one to carry the window there; the badge toggles dwindle and scrolling) and the panels in a column on its right (Proxy, Bluetooth, Network, Audio, Power: a tap opens the panel's card). **The minimap** is the stage, not a picture of it: tap a window to focus it, tap the focused one for its controls; hold a window for 0.4 s and the close bar rises, release on it to close the window (one contact and a small × are how shells get killed, so closing is a hold, a slide and a release); drag a window and a lifted copy follows the finger while its place dims, drop it onto another window to swap the two or onto a workspace tab to move it there, anywhere else and it flies home; drag the gap between two windows to move that split; in the scrolling layout drag the background to pan the strip. Each tile moves by FLIP when the layout changes, from where it was drawn (a dropped tile from the drop point). **Lists** (the menu, panels, theme picker, processes, pictures, notes; `shell/src/deck/list.tsx`) lay out every row once: the column's scroll and the highlight bar glide on the core's tracks, a finger drags the column and it settles on a whole row, and a menu level slides in from the side it was reached from. The workspace square in the bar glides between numbers. **The chord card** draws the held layer like the gamepad, the D-pad, L2/R2, START and SELECT on the left and X, Y, A, B on the right, and every cap is a tap target. Every target on the deck lights while a finger is on it and for five frames after the lift. Everything the buttons do, the deck does by touch.

**The key sheet** (L1 + SELECT) puts the whole table over the stage, with the bindings that hold without a shoulder.

**Costs.** The minimap, the three chord cards and the menu card stay mounted and show by opacity (the core culls an opacity-0 subtree from drawing), so a shoulder press repaints instead of building a card. Windows, deck bodies, the strip, the dock, the bar and list viewports carry `contain-strict`, each its own layout region. Lists and terminal runs are positional (`Index`), so new rows update nodes in place; Activity's graph sweeps one bar per sample; a terminal's PTY follows its window a quarter second after the window stops changing size, so the repaint lands after the move.

**Touch.** `shell/src/touch.ts` tracks each contact by id. A contact counts after two frames down and taps at its lift; one lifted sooner is dropped, because the Goodix panel reports brief contacts at a finger's previous position (before this filter, `l`, `s`, Enter on the keyboard ran `lss`). Each finger is its own tap, a contact that travelled more than 10 points is a drag (lists scroll by it, the minimap reads it as a move), and a tap belongs to the band it began in.

## Shell applets

The shell's own applets (`shell/src/applets/`) open as windows. Each draws its window at the size the tiling gives it and is operated by touch on the deck's body, which shows its controls on SELECT or a second tap in the map; plain D-pad and face buttons work as shortcuts. An applet polls the daemon only while its window is on the current workspace.

| Applet | Window | Deck |
|---|---|---|
| Activity | CPU (all cores, each core, a minute of history), memory, network rates, temperatures, uptime and load, in two columns when the window is 420 points wide or more | the busiest processes by CPU or by memory, dragged to scroll |
| Clock | seven-segment hours and minutes drawn from views and scaled to the window (a baked face at that size costs megabytes of atlas), seconds, date, stopwatch | the month calendar with buttons for the months, today and the stopwatch |
| Notes | the note, wrapped to the window, with a cursor while editing | the notes in `~/Documents/Notes` (Markdown, newest first), then the keyboard with pinyin; written a second after the last key and on close |
| Pictures | the picked image, scaled by omarchy-pocketd into four textures (`wallpaper {path, fit}`) and drawn at the window's size | `~/Pictures` and the theme's backgrounds, the whole picture or the panel filled, and Set as background (`omarchy-theme-bg-set`) |

The daemon's side is `daemon/applets.ts`: `systemStats` (`/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, the thermal zones, `/proc/loadavg`), `processes {sort}` (`ps`), `pictures`, `notes`, `noteRead` and `noteWrite` (a bare file name ending in `.md` under `~/Documents/Notes`).

## Screensaver

Omarchy's screensaver runs ttfx with a random effect on `~/.config/omarchy/branding/screensaver.txt` in a full-screen terminal on every monitor. Omarchy Pocket draws that text itself (`shell/src/stage/screensaver.tsx`): one Text node per character on black, an effect chosen at random from six (rain, slide, expand, decrypt, wipe, spray), held seven seconds and taken off by falling or fading, then another effect. An effect sets every node's start values with `jump` and gives the core one `animate` tween per property with its own delay, so the motion runs in the core with no script work per frame. The colours run from the theme's accent to its magenta across the columns. The deck goes black; any button or touch ends it, and the press that does is not passed on.

`omarchy-launch-screensaver` (a copy of `daemon/shim.ts` in `/usr/local/bin`, ahead of Omarchy's) exits 1 while the screensaver-off toggle is on unless its argument is `force`, and otherwise calls `omarchy-shell pocket.screensaver start`. The shell's idle timer plays hypridle's part: after shell.json's `idle.screensaver` seconds without input (150) it starts the screensaver, after `idle.lock` (300) it locks, and neither happens while Stay Awake is on (`~/.local/state/omarchy/indicators/stay-awake`); the toggles are read again when a timeout passes.

## Applets

The applets are Pocket Shell's 3DS applets (pocket-nexus/pocket-shell `shells/3ds`, branch `feat/psp-applets` at `fd07f81`, GPL-3.0-or-later, SPDX headers kept): **X, Discord, YouTube and Hacker News**, with their shared UI kit in `applets/ui/`. `applets/<name>/pocket.json` names the entry (`applets/<name>/main.tsx`) with a 512 × 384 native viewport and the applet's adaptive auxiliary surface, which this profile resolves to 512 × 384; `tools/build.ts applets [names]` compiles each to `.cache/applets/<name>.pocket`, installed to `/usr/share/omarchy-pocket/applets/`. The Apps list shows each package's own title from its manifest.

Changes from Pocket Shell: the manifests drop the PSP `full-screen` presentation and `applet.hosts`; every applet imports `fetch`, `NetError`, `companionService` and `companionNow` from `applets/lib/net.ts` instead of `@pocketjs/framework/net` and `/link`; `ui/companion.ts` names this device instead of a Mac; `ui/glyphs.ts` counts density-2 atlases against a 1 MiB response.

**A package runs in a window, never in place of the shell.** The launcher lists the shell's windows first, then packages, then terminal applications; a package opens beside the focused window like any other window (`shell/src/packages.ts`), and the window manager tiles, moves, swaps, carries and closes it.

- **Its own Runtime.** `omarchyBridge.openApp(path)` queues the package; after the shell's guest turn the host boots it in a Runtime and QuickJS realm of its own on the same profile (`host/src/children.rs`), without the Omarchy bridge. A package that fails to boot, or stops later, reports it to the shell (an `app` or `appExit` event on the bridge's line queue) and its window closes with a notice.
- **On the GPU.** Each of the package's two displays renders into a texture through a framebuffer, with a GLES renderer of its own on the shell's EGL context (`gpu::Compositor`). The shell's window holds an `Image` of a core texture handle, and the shell's renderer draws the package's texture in its place (`set_external_texture`, PocketJS's GLES backend), in the shell's paint order and with no copy; the bar, notices and the key sheet stay above it. A GL framebuffer's first row is its bottom, so the window flips the image on Y. An applet (a manifest with `applet`) draws its UI on its touch surface and leaves the top display to the system, so its window shows the touch surface, and nothing shows it twice: the deck is its touchpad. Any other package's window shows its top display, letterboxed at 4:3.
- **Demand frames.** The host advances a package only while its window is on the current workspace (`showApp`), and renders it only when one of its draw lists changed; a rendered package frame makes the shell present.
- **Sized to its tile.** An applet's touch surface is as large as its window's content when that holds the applets' 320 × 240 baseline; a smaller tile keeps its shape at the baseline's scale (a 250-point-wide split gets a 320 × 443 portrait layout drawn at 0.78), and below 0.6 the window shows a "needs a bigger tile" card and the applet pauses (`fitSurface`, `shell/src/packages.ts`). The first size goes with the window; later ones once the tile has rested 0.3 s. The host gives the surface's texture the new size under the same GL name, the Runtime takes it (`Runtime::resize_auxiliary`, pocketjs `1b890ef4`), and the applet hears `__omarchyResized` and remounts for its size class (`applets/ui/window.tsx`; it mounts only once the first size has arrived, so it never fetches for a size it is not shown at).
- **Input.** An applet is a touch app: it gets no buttons, which are the window manager's, and its touches come from the touchpad's pointer. Any other package (a game) gets, with no shoulder held, the buttons the window manager does not take (`appInput`, each frame), and a touch gamepad on the deck as its controls (D-pad; X top, Y left, A right, B bottom; START).

**Network.** PocketJS has no network in a UI realm (HTTP is a worker domain's `io.http`, which the Rust runtime does not run), so the host installs the NET ops PocketJS UI realms had before, `globalThis.net` (`start`, `take`, `cancel`, `poll`, `lastError`, plus UTF-8 `decode` and `encode`, which QuickJS lacks), in each package's realm (`host/src/net.rs`). A request crosses the bridge as an `appNet` line with its body in base64, at most 8 open per package; omarchy-pocketd answers `@net <handle> <body> <event>`, which the host hands to that package and never to the shell. When the bridge drops, every open request fails with `connect`. `applets/lib/net.ts` is the `fetch()` over these ops, polled from the frame loop's service pump while a request is open.

**Pocket Companion's services on the device.** omarchy-pocketd performs the request (`daemon/companion.ts`). A `https://companion.pocket/<service>/…` URL goes to PocketJS's own providers (`vendor/pocketjs/tools/companion/services`) for a package whose manifest lists the service in `applet.services`, with their files under `~/.local/share/omarchy-pocket/companion/services/<name>/`; any other URL goes through `performNet` (redirects checked per hop, private addresses refused, at most 1 MiB):

| Service | On this device |
| --- | --- |
| `x` | the Mac's `services/x/session.json` and `operations.json` copied over; avatars scaled to 32 × 32 by ffmpeg (the Mac runs `sips`) |
| `discord` | the Mac's `services/discord/token` (the bot) copied over |
| `youtube` | yt-dlp and ffmpeg from Arch's packages; feeds, search and thumbnails. Playback streams a media plane this host does not implement; the applet finds no `globalThis.media` and offers none |
| `glyphs` | `POST /glyphs/atlas` answered by a long-lived baker child (`omarchy-pocketd.js atlas-baker`, niced, gone after 60 s idle) with PocketJS's `bakeSlot` at density 2, wqy-microhei then the JetBrainsMono Nerd Font |

Discord and YouTube need a proxy from this network: mihomo runs on the device as `mihomo.service` (127.0.0.1:7897, configuration built from the Mac's Clash Verge profile, kept in `/etc/mihomo`, not in this repository), and a device-local drop-in `/etc/systemd/user/omarchy-pocketd.service.d/proxy.conf` sets `HTTPS_PROXY` for the daemon. The image carries neither.

**Verified on the device:** Hacker News loads the front page (41 requests on open) in a window; beside a terminal it lays out as a 320 × 443 portrait page in its half of the stage, and a touchpad click on its New tab switched the feed; X loads the home timeline through the copied session (66 KB, 1.6 s with x.com's client cached; 9.3 s for the first read of its scripts), its avatars (2 KB, about 0.57 s each through ffmpeg) and three glyph atlases (92 KB to 261 KB, 1.2 s to 1.6 s each); Discord lists the bot's server (0.6 s) and YouTube answers a search (9.3 s, yt-dlp). Discord and YouTube were exercised through the bridge socket (`appNet` lines from a second peer), not on screen.

## Proxy

mihomo, the core Clash Verge Rev runs, is Omarchy Pocket's proxy, with a panel of its own: the Proxy indicator in the bar and the map's right column (while mihomo is installed; dimmed while stopped), Omarchy's menu › Setup › Proxy, and `omarchy-shell shell summon omarchy.proxy`. The panel turns the unit on and off, cycles the mode (rule, global, direct), and lists the selector groups with the node each uses and its last delay; left and right pick a group's previous or next node and A tests the group's nodes (`/group/<name>/delay` against `generate_204`, 3 s). The daemon side is `daemon/proxy.ts`: systemd for the unit, mihomo's controller on 127.0.0.1:9097 for the rest. Node names are CJK: the panel asks the daemon to bake their glyphs and drops flag emoji, which no face draws.

On the device, and not in this repository: mihomo 1.19.32 as `mihomo.service`, `/etc/mihomo/config.yaml` built from the Mac's Clash Verge profile (mixed port 127.0.0.1:7897, no LAN listeners), the controller's secret in `/etc/omarchy-pocket/mihomo.secret` (root:omarchy, 0640), and the daemon's `HTTPS_PROXY` drop-in; the daemon drops its proxy variables while mihomo is stopped. `device/rootfs/etc/polkit-1/rules.d/50-omarchy-pocket-proxy.rules` lets the Omarchy user start, stop and restart that unit and no other. Measured through it: discord.com 0.2 s, youtube.com 0.5 s, x.com 0.4 s, 3.3 to 3.8 MB/s (the Wi-Fi's ceiling), 43 MB resident.

## Chinese input

The 中 key on the touch keyboard switches pinyin on (`shell/src/term/ime.ts`). Letters and punctuation build a key transcript in PocketJS's IME key codes (`contracts/spec/ime.ts`); `ime {keys}` evaluates the whole transcript in a fresh Rime session (`daemon/ime.ts` around PocketJS's `tools/ime/rime.ts`, with `rime.c` built against Arch's librime as `/usr/lib/omarchy-pocket/pocket-rime`) and returns preedit, five candidates and any committed text. A key that can commit (Space, a digit, Enter, punctuation) holds later keys until its answer is in, so committed text keeps its order. Password fields bypass composition.

- The pinyin data directory `~/.local/share/omarchy-pocket/ime` gets Luna Pinyin, the essay and PocketJS's `pocket_pinyin` schema, built with `rime_deployer` when the daemon starts the first time (14 s on the RK3568). A transcript answers in about 90 ms.
- The daemon bakes GB2312 level 1 (3,755 characters, from `TextDecoder("gbk")`) into the run-time atlases at start, in a `nice`d baker process (about 40 s once; the daemon stays near 37 MB). Each baked set is cached under `~/.cache/omarchy-pocket/glyphs`; a restarted daemon publishes it in seconds. Characters outside the set are added by small bakes as they appear.
- The host raises the GLES glyph cache to 32 MB (64 pages of 512 × 512): a line of candidates pins pages from a 3,871-glyph atlas, and the default 4 MB (eight pages) made the frame fail.

## Input

Measured on the device, and matching the stock firmware's SDL mapping (`gamecontrollerdb.txt`):

| Physical | evdev | PocketJS button |
|---|---|---|
| A / B / X / Y | 304 / 305 / 307 / 306 | CIRCLE / CROSS / TRIANGLE / SQUARE |
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

The stage shows the wallpaper, the current workspace's windows and Omarchy's bar (logo, workspaces 1–5, clock, Bluetooth/network/audio/power indicators from SystemState, in the order of Omarchy's default `shell.json`), the OSD near its bottom edge and notices in its top-right corner. Omarchy's menu opens in the stage's card on L1 + A or the dock's first cell: the D-pad or the deck's remote moves, A opens, B goes back. The panels open from the map's right column or a pointer click on the bar. Opening a level asks the daemon for its rows' conditions: a row with a `when` appears once its command exits 0, a `checked` row shows a check mark, a `disabled` row dims. A row's action runs through the daemon; a nonzero exit shows a notice with the command's last line of output, and the level's conditions are read again. The bottom panel holds one `AuxiliarySurface`: each portal is a flex child of the panel's root, so two portals share its width. The portal inserts its child once (PocketJS's `renderPortalChild` calls the child's accessor), so a `Show` at the top of a portal never switches; the deck's chain of `Show`s sits inside a View.
