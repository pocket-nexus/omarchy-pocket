# Omarchy Pocket on the RG DS Plus

Omarchy Pocket runs Omarchy's CLI, themes, config and Linux services on Arch Linux ARM, and draws its whole UI with one PocketJS program on the Mali-G52. There is no Hyprland, Quickshell, SDDM or uwsm on the device. Lines marked **verified** were checked on the device on 2026-10-29.

## Layers

| Layer | Where | What |
|---|---|---|
| Boot chain | `device/stock/rgds-init` on the stock rootfs (p6) | busybox PID 1: mounts p7 `omarchy`, pivots the stock root to `/mnt/stock`, execs systemd |
| System | `image/build-root.ts`, `device/rootfs/` | Arch Linux ARM + Omarchy rc packages (CLI, themes, config, services), libmali, the USB link, power and lid handling |
| Device program | pocketjs `programs/rg-ds-plus` | GBM/EGL/GLES on both DSI panels through libmali, evdev input, one QuickJS realm |
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
5. `device`: `device/rootfs/`, libmali in `/usr/lib/mali`, `pocket-rg-ds-plus` and the shell package, timezone Asia/Shanghai, enabled units.

`image/install.ts` drives the stock firmware over SSH: `check`, `partition` (refuses without the backup), `extract` (bsdtar from the ALARM chroot with `--xattrs --acls --no-fflags`), `configure` (hostname, empty machine-id, the stock SSH host keys, NetworkManager profiles, firmware, the stock kernel's Wi-Fi and Bluetooth modules), `chooser`, `reboot`.

## Device program (pocketjs `programs/rg-ds-plus`)

- **GPU only.** libmali's GBM device on `/dev/dri/card0`, one EGL context, one GBM surface and EGL window surface per panel, `pocket-gles2` rendering. A flush makes the panel's surface current (presentation renders every panel before flushing any), swaps, adds the GBM front buffer to KMS once and page-flips; a wait takes the flip event for that CRTC and returns the previous buffer to GBM.
- The program links `libmali.so.1` directly: libmali's `libEGL`/`libGLESv2`/`libgbm` are 5.7 KB wrappers that export none of those symbols.
- `--shot DIR --script …` runs the package on a Mac with the CPU raster renderer, for layout work only.
- `touch /tmp/pocket-shot` on the device reads both panels back with `glReadPixels` into `/tmp/pocket-shot-<panel>.rgba`.

**Verified:** `display: GBM/EGL 1.5, GLES 2 renderer on 2 panels`. With the shell running: process RSS 73 MB (anon 30 MB), the Mali driver's context for the process 2326 pages (9 MB), system `MemAvailable` 759 MB of 953 MB. For comparison, Hyprland 0.56 alone held 305 MB of GPU memory on the same device ([hyprland-on-libmali.md](hyprland-on-libmali.md)).

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

The Wi-Fi driver (`RTL8821CS.ko`, vermagic 6.1.141) and the UART Bluetooth glue (`hci_uart.ko`, `rtk_btusb.ko`) are modules of the stock kernel in the stock rootfs's flat `/lib/modules`. `configure` copies them to `/usr/lib/modules/6.1.141/extra`, runs `depmod` and loads `RTL8821CS` from `modules-load.d`. NetworkManager uses `wpa_supplicant`. Bluetooth needs `hci_uart` plus the stock `rtk_hciattach … rtk_h5` on the DT's UART; not wired yet.

## Shell (`shell/`)

`tools/omarchy-assets.ts` takes everything Omarchy-specific from the pinned rc packages (`omarchy`, `omarchy-settings`, `ttf-jetbrains-mono-nerd-basic`, by name and sha256):

- the menu tree from `default/omarchy/omarchy-menu.jsonc` (11 root entries, 211 rows);
- the theme's colours from `colors.toml`, substituted into `classes.template.ts`, because PocketJS keys its style table by whole class strings;
- the theme's first background, cropped to 4:3 and cut into 256-point tiles, because a package image is a power of two of at most 512 texels;
- `fonts.json` with Omarchy's glyph font before the JetBrainsMono Nerd Font (the Nerd Font maps a devicon at U+E900, Omarchy's logo).

The stage shows the wallpaper under Omarchy's bar (logo, workspaces 1–5, clock, Bluetooth/network/audio/power indicators, in the order of Omarchy's default `shell.json`). The deck lists the Omarchy menu: D-pad or touch moves, A opens, B goes back, L1/R1 page, L2/R2 switch workspace, Start returns to the root. Rows with a `when` condition stay hidden and actions show their command, until the Omarchy bridge evaluates conditions and runs actions.
