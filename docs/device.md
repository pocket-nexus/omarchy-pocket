# RG DS Plus: device facts

Read from the unit on the bench (2026-10-28, stock Anbernic firmware). Every value below came from the running device; the command that reads it is given where it is not obvious.

## Access

| | |
|---|---|
| Wi-Fi address | `192.168.8.175` on the GL.iNet debug AP (`GL-SFT1200-128-5G`) |
| SSH | `root` / `root`, OpenSSH `sshd` started by `/etc/init.d/S50sshd` |
| USB | the OTG USB-C port, see [usb-link.md](usb-link.md) |

The Mac has no `sshpass`. Non-interactive password login uses `SSH_ASKPASS=<script that prints root> SSH_ASKPASS_REQUIRE=force ssh …`.

## SoC, memory, storage

- Rockchip RK3568, 4× Cortex-A55 (`CPU part 0xd05`), 408 MHz to 1.99 GHz.
- 976 760 kB RAM, no swap configured. The kernel has `CONFIG_ZRAM=y` (lzo-rle default).
- One 16 GB SD card (`mmcblk1`). There is no eMMC: `/sys/class/anbernic_misc/boot_device` reads `1` (SD boot) and no `mmcblk0` exists.

GPT layout of the card:

| # | Label | Size | Type | Mounted at |
|---|---|---|---|---|
| p1 | uboot | 4 MB | raw | |
| p2 | misc | 4 MB | raw | |
| p3 | boot | 64 MB | raw (kernel image) | |
| p4 | recovery | 128 MB | raw | |
| p5 | backup | 32 MB | raw | |
| p6 | rootfs | 5 GB | ext4 | `/` (811 MB used) |
| p7 | ports | 512 MB | ext4 | `/mnt/ports` |
| p8 | vendor | 1 GB | ext4 | `/mnt/vendor` (Anbernic launcher) |
| p9 | oem | 3 GB | ext4 | `/oem` |
| p10 | userdata | 1 GB | ext4 | `/userdata` |
| p11 | ROMS | 3.3 GB | vfat | `/mnt/mmc` |

## Boot

U-Boot `evb_rk3568` (2026-09-15) boots the kernel from `boot` with:

```
storagemedia=sd androidboot.storagemedia=sd androidboot.mode=normal androidboot.verifiedbootstate=orange rw rootwait loglevel=4 initcall_debug=0 earlycon=uart8250,mmio32,0xfe660000 console=ttyFIQ0 root=PARTUUID=614e0000-0000 androidboot.fwver=ddr-v1.25-5b48980fd7,spl-v1.14,bl31-v1.46,bl32-v2.16,uboot-evb_rk3568-09/15/2026
```

There is no initramfs and no `/lib/modules`: every driver is built in. `/proc/config.gz` is present.

## Kernel and userland

- Linux 6.1.141 aarch64 (Rockchip BSP), Buildroot 2024.02 userland, busybox init (`/etc/init.d/S*`), glibc, Python 3.11.
- `/etc/init.d/S49weston` starts Weston on DRM; `/etc/init.d/S60launch` starts the Anbernic launcher (`/mnt/vendor/bin/dmenu.bin`, ~140 MB RSS) through `/mnt/vendor/ctrl/loadapp.sh`.
- NetworkManager + wpa_supplicant (`nmcli` works), PulseAudio, BlueZ (`bt-agent`).
- systemd prerequisites in the kernel config: `CGROUPS`, `NAMESPACES`, `USER_NS`, `FHANDLE`, `SECCOMP_FILTER`, `DEVTMPFS`, `INOTIFY_USER`, `SIGNALFD`, `TIMERFD`, `EPOLL`, `TMPFS_POSIX_ACL` are set. `BPF_SYSCALL` and `AUTOFS_FS` are not set.
- Also set: `INPUT_UINPUT`, `FUSE_FS`, `SQUASHFS`, `VT`, `DMABUF_HEAPS` (system, CMA, Rockchip CMA).

## Display and GPU

- Two MIPI DSI panels, `card0-DSI-1` and `card0-DSI-2`, each 1024×768. `card0-Writeback-1` is the VOP writeback connector.
- Mali-G52 (1 core, r1p0) on the Arm kbase driver (`CONFIG_MALI_BIFROST=y`, `/dev/mali0`). Panfrost is not built.
- Userspace GPU stack is the Rockchip blob `libmali-bifrost-g52-g24p0-wayland-gbm.so`; `libEGL.so.1`, `libGLESv2.so.2` and `libgbm.so.1` in `/usr/lib` point at it.

## Input

From `/proc/bus/input/devices`:

| Device | Node |
|---|---|
| `ANBERNIC-rk3568-keys` (gamepad) | `event5`, `js0` |
| `gt9xx-0` (Goodix touch, one panel) | `event1` |
| `adc-keys` | `event4` |
| `dierct-keys-polled` | `event6` |
| `rk805 pwrkey` | `event0` |
| `headset-keys`, `rockchip-rk817 Headset` | `event2`, `event3` |

## Radios, audio, power

- Wi-Fi + Bluetooth: Realtek RTL8821C over SDIO; firmware in `/lib/firmware/rtl8821c_fw`, `rtl8821c_config`, `rtlbt/`.
- Audio: RK817 codec plus an AW883xx speaker amplifier (`aw883xx_acf.bin`).
- Battery gauge: `cw2015-battery`; charger: RK817 (`/sys/class/power_supply/{ac,usb,battery}`).

## Traps found on this unit

- `pkill -f <pattern>` inside `ssh root@… '…'` matches the remote shell that runs the command line, so it kills the SSH session. Anchor the pattern, for example `pkill -f '^python3 /tmp/usbmux.py'`.
- `/etc/init.d/S99-auto-reboot` starts a reboot loop only if `/userdata/rockchip-test/auto_reboot.sh` exists.
