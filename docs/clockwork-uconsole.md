# Omarchy Pocket on the ClockworkPi uConsole

The ClockworkPi uConsole (Raspberry Pi CM4, Raspberry Pi OS 13 "trixie") runs Omarchy Pocket beside its own desktop, from one Debian package, `omarchy-pocket-uconsole`: the RG DS Plus's host program, built with Mesa in place of libmali, on the uConsole's one panel; the shell laid out for one screen and a keyboard; and Omarchy's CLI, themes and omarchy-pocketd in an Arch Linux ARM root under chroot, reaching Raspberry Pi OS's NetworkManager, PipeWire, BlueZ and logind. Nothing of Raspberry Pi OS is replaced: the panel goes back to its desktop from Omarchy's System menu, and removing the package gives the desktop back at boot too. Lines marked **verified** were checked on a uConsole (CM4 Rev 1.0, 4 GB, kernel 6.12.62-v8) on 2026-11-11.

## Install

```sh
curl -LO https://github.com/pocket-nexus/omarchy-pocket/releases/download/v0.2.1/omarchy-pocket-uconsole_0.2.1_arm64.deb
sudo apt install ./omarchy-pocket-uconsole_0.2.1_arm64.deb
omarchy-pocket-session on
```

The package's configure step makes the user with uid 1000 the session's user (`OMARCHY_POCKET_USER=<name>` names another), puts them in the `omarchy-pocket` group, and downloads Omarchy's root from the release (`omarchy-pocket-root.tar.zst`, 802 MB, the AYN Thor's), checks its SHA-256 against the one the package carries (`/usr/lib/omarchy-pocket/root.conf`) and unpacks it into `/var/lib/omarchy-pocket/root` (2.7 GB). An archive already in `/var/cache/omarchy-pocket/` with the right size is used instead of the download; `sudo /usr/lib/omarchy-pocket/omarchy-root install [archive]` runs this step again.

| Switch | From Omarchy Pocket | From the Raspberry Pi desktop | Anywhere |
|---|---|---|---|
| to Omarchy Pocket now | | Omarchy Pocket in the menu (System) | `omarchy-pocket-session on` |
| to the desktop now | System › Raspberry Pi Desktop in Omarchy's menu | | `omarchy-pocket-session off` |
| what boots | | | `omarchy-pocket-session boot` or `desktop` (asks for sudo) |

`sudo apt remove omarchy-pocket-uconsole` stops Omarchy Pocket and gives the panel back to the desktop, now and at boot; Omarchy's root stays. `sudo apt purge omarchy-pocket-uconsole` also removes the root, with the Omarchy user's home in it.

## Layers

| Layer | Where | What |
|---|---|---|
| Device program | `host/` with feature `mesa` and profile `uconsole/pocket.host.json` | Mesa's GBM, EGL and GLES 2 on vc4 KMS; the stage turned a quarter onto the portrait panel (`host/src/gpu.rs`); the keyboard's three input functions (`host/src/uconsole.rs`) |
| Profile | `uconsole/pocket.host.json` | `clockwork-uconsole`: 640 × 360 points at density 2 (1280 × 720), and an auxiliary surface of the same size that no panel shows |
| Omarchy's root | `/var/lib/omarchy-pocket/root` | the AYN Thor's root (`tools/android.ts rootfs`: the RG DS Plus image without what only that device uses), run by `omarchy-root` |
| Package | `uconsole/rootfs/`, `uconsole/debian/` | `omarchy-pocket.service` (the shell in the user's logind session on tty1), `omarchy-pocketd.service` (the daemon in the root), `omarchy-pocket-session`, PAM, polkit, logind, tmpfiles, the desktop's menu entry, and the files the root takes at each start (`/usr/lib/omarchy-pocket/overlay`) |
| Daemon | `daemon/` with `daemon/uconsole.ts` | omarchy-pocketd as on the RG DS Plus; the uConsole's backlight, brightness, mute and power keys |
| Shell | `shell/` | one package for every device; on the uConsole (`screen.ts` `UCONSOLE`) the stage takes the whole panel and the input of `super.ts`, `hardkeys.ts` and `trackball.ts` replaces the deck |

## The controls

The keyboard is an STM32 on USB (`1eaf:0024`) whose firmware is ClockworkPi's (clockworkpi/uConsole, `Code/uconsole_keyboard`). Under the panel, in one row the thumbs share, sit the D-pad, L and R (L above and left of R), the trackball, and Y X over B A; the keyboard is under that row, with Esc, SELECT and START at the left of its top row. The kernel sees four HID functions:

| Node | Reports | Read by |
|---|---|---|
| `ClockworkPI uConsole Keyboard` | the keys; the D-pad as the arrow keys (with Fn: Page Up, Page Down, Home, End); Fn + Alt as Cmd (`KEY_RIGHTMETA`) | the host: text events, and the D-pad as buttons |
| `ClockworkPI uConsole` | a joystick: A, B, X, Y, SELECT, START as buttons 2, 3, 1, 4, 9, 10 (`BTN_THUMB`, `BTN_THUMB2`, `BTN_TRIGGER`, `BTN_TOP`, `BTN_BASE3`, `BTN_BASE4`); the D-pad on its X and Y axes in firmware before the arrow keys | the host: buttons |
| `ClockworkPI uConsole Mouse` | the trackball (`REL_X`, `REL_Y`), L and R (`BTN_LEFT`, `BTN_RIGHT`), the ball's press (`BTN_MIDDLE`); while SELECT is held the firmware sends the ball's rolls as `REL_WHEEL` | the host, for the shell's pointer |
| `ClockworkPI uConsole Consumer Control` | the volume key (with Shift: up), Fn + the volume key (mute), Fn + , and Fn + . (brightness) | omarchy-pocketd |

The AXP228's power key is `axp20x-pek` (`KEY_POWER`), which omarchy-pocketd reads; logind ignores a press (`HandlePowerKey=ignore`) and powers off on a long one.

## The interaction system on the uConsole

The RG DS Plus's three lines ([interaction.md](interaction.md)) become these on one screen with a keyboard:

**The stage is the panel.** It is the RG DS Plus's stage at the AYN Thor's size: the wallpaper, the windows tiled as Omarchy tiles them, Omarchy's bar, the card, the OSD, notices and the key sheet. Nothing is drawn for a deck.

**The keyboard is the keyboard.** Its keys go where the deck's keys go (`focus.ts` `keySink`): a terminal, the card (typing filters the menu), Notes, a text field. A text field that has the keys (the lock, a Wi‑Fi password) is drawn on the stage above its bottom edge with what the keys do there (`stage/field.tsx`).

**The trackball is the trackpad, and L and R are the mouse's buttons** under every layer.

**START is SUPER.** A thumb cannot hold a modifier and press the D-pad beside it, and the uConsole has no shoulders, so START, under the left thumb, is SUPER both ways (`super.ts`):

- **held**, it is the window layer while it is down: a chord with the other thumb (START + A opens the menu) or a key (START + W closes);
- **tapped**, the window layer stays: a second tap turns it to the move layer, a third lets it go, and so do Escape and any verb. The D-pad's steps keep it, so focus walks from window to window with the left thumb alone.

The keyboard's own SUPER (Fn + Alt, sent as Cmd) holds the window layer as START does, and Shift turns either layer into the move layer, as on Omarchy.

| Layer | D-pad | A | B | X | Y | SELECT |
|---|---|---|---|---|---|---|
| plain | the arrows | Enter | Backspace | Tab | Space | (alone) the controls row |
| window (SUPER) | focus; past the last window, the workspace beside | menu | close | fullscreen | toggle split / column width | key sheet |
| move (SUPER ⇧) | swap; past the last window, carry it to the workspace beside | open another | reopen closed | maximize | swap split / (un)stack | toggle bar |

A step past the last window goes to the workspace beside and stops at the first and the fifth, as the bar lays them out; a held D-pad's repeats stop at the last window, and only a press goes past it.

Under SUPER the keyboard has Omarchy's own bindings (`superkeys.ts`, after `default/hypr/bindings/tiling.lua` and `utilities.lua`): Return a terminal, Space the menu, W or Q close, F fullscreen, J split, L the layout, K the key sheet, Escape the System menu, the arrows focus (with Shift, swap), 1–5 a workspace (with Shift, carry the window there), Tab and `]` the next workspace, Shift+Tab and `[` the previous one, `-` and `=` resize. A key the layer does not bind lets a latched layer go and is typed.

**The trackball** (`trackball.ts`) moves the pointer, relative and accelerated (0.9 points per count at rest, up to 2.6). Its clicks act by what is under the pointer (`stage/pointer.tsx` `targetAt`):

| | L, or the ball pressed | R |
|---|---|---|
| a touch app (an applet) | a touch held until the button lets go: a press is a tap, a press and roll a drag | Back (the applet hears Cross) |
| the card | a row (a tap selects, a tap on the selected row opens it); outside the card, the card closes | back a level, out at the top |
| the bar | the logo opens the menu; a number goes to its workspace; an indicator opens its panel | a number carries the focused window there |
| a window | focus | focus |
| the wallpaper | — | Omarchy's menu, where a desktop puts its own |

SELECT held turns the ball into a wheel (the firmware does it): the list under the pointer scrolls, the card's selection moves, and under SUPER the wheel steps workspaces, as Omarchy's SUPER + wheel does. SELECT pressed and let go with no roll in between is SELECT's own press: the controls row alone, the key sheet or the bar under SUPER. The pointer shows from the ball's first roll until the next typed key, as a laptop's does.

**The controls row.** While a layer is latched, or held for 14 frames, and while SELECT's help is up, the stage draws the controls row along its bottom edge (`stage/controls.tsx`), each control's icon and word right above the control under the panel. ClockworkPi's drawing (`Clockwork_uConsole_Assembly_Guidelines.pdf`, "The Interfaces") puts their centres at these fractions of the panel's width: the D-pad 13%, L 30%, R 34%, the ball 65%, Y 79%, X 88%, B 83.5%, A 92%. A title line names the layer and what START does next. The bar names the layer from its first frame.

**Sleep.** The CM4 has no suspend to RAM. The power key darkens the panel (its backlight at 0) and locks the shell; the next key, button or roll lights it again on the lock screen, and that input does nothing else (the daemon's `screen` event). The password is the device user's: `omarchy-root` copies its hash to the root's Omarchy user at each start, and unix_chkpwd in the root checks it.

**Games.** A package that is not a touch app hears the D-pad and A B X Y, and START when it is tapped while the game has focus.

**Verified** with uinput devices named as the keyboard's functions (the host enumerates them as it does the real ones): typing a shell command with Shift and symbols into Pocket Term; START tapped then Return opens a terminal, twice tiles two; START tapped and the D-pad focuses, past the last window steps the workspace; START tapped twice and the D-pad swaps; START held + A opens the menu; Cmd + Space opens it, Return opens Apps, typing filters it to Hacker News and Return opens it; the wheel moves the menu's selection and scrolls Hacker News; L opens a story and R goes back; SELECT alone shows the controls row; SUPER + K the key sheet; the power key darkens the panel and locks, a key lights it without typing, and the device user's password unlocks.

## Display

The panel (`DSI-1` on `card1`, vc4; `card0` is v3d's render node) scans out 720 × 1280. vc4's planes turn by 0° or 180° only, so the stage renders at 1280 × 720 into a texture and a quad turns it a quarter clockwise onto the panel's GBM surface: the scanout's pixel (gx, gy) shows the frame's texel (1279 − gy, gx), which puts the frame's top edge down the panel's right side, where labwc's `transform 270` puts it. A readback (`/tmp/pocket-shot`) is the frame as drawn, before the turn.

The profile keeps an auxiliary surface of 640 × 360 points: the applets in the shell's windows draw their touch surfaces on their auxiliary displays (children.rs), and the shell's own is drawn into a texture no panel shows and never presented. The shell draws nothing on it (`HAS_DECK`).

**Verified:** `display: GBM/EGL 1.5, GLES 2 renderer on 2 panels (1 shown, turned a quarter)`; the scanout read with `ffmpeg -f kmsgrab` has the bar down its right edge, as labwc's desktop does. A present of the stage costs 15 to 20 ms (`OMARCHY_POCKET_TIMING=1`), the swap and the flip under 4 ms of it; guest and core take 0.3 to 0.5 ms a tick. Raising the CPU's floor to 1.5 GHz (`etc/tmpfiles.d/omarchy-pocket-cpu.conf`, the RG DS Plus's floors in `host/src/floor.rs`) left that unchanged: the VideoCore VI's clock is the firmware's.

## Omarchy's root and the session

`/usr/lib/omarchy-pocket/omarchy-root` (`uconsole/rootfs/`) runs as root and prepares the root at each start:

- the package's overlay copied in: omarchy-pocketd and its shims, the applets for the uConsole's profile, and the root's own `omarchy-pocket-session` (`off` starts lightdm, which both units conflict with);
- bind mounts, each a slave of the system's mount (an unmount under the root never reaches the system's), of `/dev`, `/proc`, `/sys`, `/run/dbus` (NetworkManager, BlueZ, logind), `/run/udev`, `/run/user/<uid>` (PipeWire, the session bus, the bridge socket), `/run/systemd` and `/tmp` (omasnap's readback is the host program's `/tmp/pocket-shot`); `/etc/resolv.conf`, the timezone and the host name are copied in;
- the root's Omarchy user takes the device user's uid, gid and password hash (`alarm`, which held uid 1000 in the image, moves to 1003), and its home is the user's;
- `WAYLAND_DISPLAY` names `/run/user/<uid>/omarchy-pocket/display`: Omarchy's `omarchy-shell` names the shell's socket after it, and without one takes the newest `wayland-N` in the runtime directory, the Raspberry Pi desktop's, which lingers after it stops.

`omarchy-root daemon` sets Omarchy's theme on the first start and becomes omarchy-pocketd as the user (`chroot --userspec`, with the user's groups); `omarchy-root run <command>` runs a command there, as `tools/uconsole.ts exec` does over SSH.

| Unit | Runs |
|---|---|
| `omarchy-pocket.service` | `omarchy-pocket-host` as the user, `PAMName=omarchy-pocket` on tty1: an active logind session on seat0, the RG DS Plus's arrangement. `Conflicts=lightdm.service getty@tty1.service`; the user is a drop-in the package's postinst writes (`omarchy-pocket.service.d/user.conf`) |
| `omarchy-pocketd.service` | `omarchy-root daemon`, after the user's manager (`user@<uid>.service`, the postinst's drop-in), which brings the runtime directory, the session bus and PipeWire. `Conflicts=lightdm.service` |

`50-omarchy-pocket.rules` (`/usr/share/polkit-1/rules.d`) lets the `omarchy-pocket` group start and stop the two units and lightdm, so either session switches to the other without a password. The daemon is outside the session's cgroup, so the rule also gives the group logind's power actions, NetworkManager's and BlueZ's.

omarchy-pocketd reads input devices through `cat` (`daemon/evdev.ts`): a read stream on `/dev/input/event*` held one of Bun's pool threads in a blocking read, the pool also resolves host names, and with the uConsole's devices open every applet's fetch waited for DNS until it timed out.

## The daemon on the uConsole

`OMARCHY_POCKET_PLATFORM=uconsole` (`daemon/uconsole.ts`):

- **Backlight:** every directory in `/sys/class/backlight` moves together (`backlight@0`, an OCP8178 with ten levels; world-writable on Raspberry Pi OS). Fn + , and Fn + . step it a tenth with Omarchy's OSD.
- **Mute:** Fn + the volume key toggles the default sink, with the OSD. The volume key itself is `volume-keys.ts`'s, as on the RG DS Plus.
- **Power key:** above.
- **Battery:** `axp20x-battery`, the one supply of type Battery.
- **`hyprctl monitors`** describes one 1280 × 720 display; **omasnap** reads the stage back at 1280 × 720.

**Verified:** the bar shows the battery charging at 100%, the Wi-Fi network and its signal, the volume and Bluetooth from Raspberry Pi OS's services; Hacker News's requests (`app net GET hacker-news.firebaseio.com/v0/topstories.json 200 4501B 598ms`) and Pocket Term's sessions run through the root's omarchy-pocketd. RSS: the host program 137 MB, omarchy-pocketd 54 MB, of 3.8 GB.

## Build from source

Needs `cargo-zigbuild` and the `aarch64-unknown-linux-gnu` Rust target, as the RG DS Plus does, `dpkg-deb` (Homebrew's `dpkg` on a Mac), and SSH to the device's user with passwordless sudo.

```sh
bun tools/omarchy-assets.ts                        # once, as for the RG DS Plus
bun tools/uconsole.ts all <user>@<uconsole>        # Mesa's libs, host, shell, applets, daemon, the package, apt install
bun tools/uconsole.ts install <user>@<uconsole> --root omarchy-pocket-root.tar.zst   # the root from a local archive
bun tools/uconsole.ts push <user>@<uconsole> shell # one part into the installed package's places, and restart
bun tools/uconsole.ts session <user>@<uconsole> on
bun tools/uconsole.ts exec <user>@<uconsole> 'omarchy-shell pocket.window list'
bun tools/uconsole.ts release                      # dist/uconsole/<version>/: the package and SHA256SUMS
```

`uconsole/release.json` names the version and the root the package installs: the release's URL, SHA-256 and size.

The applets build from a copy of `vendor/applets` for the uConsole's contract (`tools/uconsole.ts applets`): Discord, GitHub, Hacker News, Home Assistant, Maps, Podcasts, Weather, X and YouTube. The Store and Spotify stay omarchy-pocket's, Notes, Photos and Camera need capabilities the profile lacks.

`pocket.input` drives the uConsole's input over SSH for testing: `ball <dx> <dy> [frames] [buttons]`, `button <bits> [frames]`, `wheel <detents>`, `hardkey <name>`, `hardtext <text>`, `super`, `where`.

## Limits

- **The joystick's codes** come from ClockworkPi's firmware source and the device's HID report descriptor (32 buttons from `BTN_TRIGGER`); the buttons were exercised through uinput devices of the same names, not pressed on this unit.
- **Voice input:** the uConsole has no microphone.
- **Pinyin:** the deck's 中 key has no keyboard binding yet; Chinese is not typed on the uConsole.
- **SUPER + drag** (Omarchy's move and resize with the mouse) is not bound.
- **Applets' wording:** pocket-nexus/applets says "your Mac" for its services on every target but `rg-ds-plus` (`ui/companion.ts`); on the uConsole and the Thor they run in omarchy-pocketd on the device.
- **The Raspberry Pi desktop** stays installed and starts at boot until `omarchy-pocket-session boot`.
- **One user:** the package runs the shell for one account, uid 1000's unless named.
