# Hyprland on the stock kernel and libmali

Result of the GPU spike (2026-10-29): Omarchy's Hyprland renders on both DSI panels of the RG DS Plus through Rockchip's Mali blob, with the stock Rockchip kernel left in place. Files are in [`experiments/hyprland-libmali/`](../experiments/hyprland-libmali/).

## Setup

- Root: Arch Linux ARM `ArchLinuxARM-aarch64-latest.tar.gz` (2026-08-05), built in an OrbStack arm64 container with Omarchy's `default/pacman/aarch64` stable templates (`[omarchy]` at `pkgs.omarchy.org/stable/aarch64` plus Omarchy's ALARM mirror). ALARM's kernel and every `linux-firmware*` package removed: 1.3 GB.
- Packages: `hyprland 0.56.2-7` (Omarchy's build), `aquamarine 0.15.1-1`, `glibc 2.43`, `seatd`, `foot`, `grim`.
- On the device: the root is a directory, `/opt/arch`, on the stock `rootfs` partition, entered with `chroot`. Host `/proc`, `/sys`, `/dev` and `/run/udev` are bind-mounted. The stock launcher and Weston are stopped (`/tmp/stopAPP.ini` ends the `loadapp.sh` loop). `seatd -g seat` hands DRM and input devices to Hyprland, which runs as user `omarchy`.
- GPU: the libmali files from `/usr/lib` (`libmali.so.1.9.0` and its 5.7 KB `libEGL`/`libGLESv2`/`libgbm` wrappers) go into `/opt/arch/opt/mali`, first on `LD_LIBRARY_PATH`.

Transfer of the root over the [USB link](usb-link.md): 1.3 GB in 88 s.

## What had to change, in the order the failures appeared

| Failure | Cause | Spike fix | Proper fix |
|---|---|---|---|
| `su: failed to execute /bin/bash` | `docker export` root extracted by busybox tar as mode 700 | `chmod 755 /opt/arch` | image builder sets modes |
| Mesa `failed to create dri2 screen` | `/opt/mali` created under umask 077, so the user's loader skipped it and fell back to glvnd/Mesa | `umask 022`, `install -m 755` | same |
| `Couldn't open a GBM device` | libmali's GBM allocates from `/dev/dma_heap/system-uncached`, `root:video 0660` with the Buildroot `video` gid, which differs from Arch's (983) | `chmod 666` on `dma_heap/system*`, `mali0`, `rga`, `mpp_service` | udev rules in the image: `dma_heap`, `mali0`, `rga`, `mpp_service` to group `video` |
| abort, `eglGetProcAddress(eglDebugMessageControlKHR) failed` | Hyprland `src/render/OpenGL.cpp:302` loads it unconditionally; libmali has no `EGL_KHR_debug`. It is only called under `EGL_KHR_debug` and `debug:gl_debugging` (line 322) | `egl-shim.c` answers the lookup with a no-op | Hyprland: load it inside the `EGL_KHR_debug` branch |
| crash right after the EGL proc loads | `OpenGL.cpp:339` enters the EGL-device path when `eglQueryDevicesEXT` was **not** loaded (`… \|\| !m_proc.eglQueryDevicesEXT \|\| …`) and calls it through a null pointer | shim advertises `EGL_EXT_device_enumeration`/`_query` with "no devices" stubs, so Hyprland takes its GBM path | Hyprland: require the procs for the device path (`&&`), fall through to GBM otherwise |
| `Couldn't retrieve openGL extensions!` | Hyprland and aquamarine link glvnd's `libOpenGL.so.0`; with libmali's non-glvnd EGL, `libGLdispatch` has no current vendor and `glGetString` returns NULL | `/opt/mali/libOpenGL.so.0 -> libmali.so.1` (`ldd -r` reports no unresolved symbol) | same link in the image, or a glvnd vendor library for libmali |
| `atomic drm request: failed to commit: Invalid argument` on every frame | the commit carries the VOP2 cursor plane | `cursor.no_hardware_cursors = 1` | find the plane constraint (format, size or zpos) in aquamarine or the VOP2 driver |

Both Hyprland issues are present on Hyprland `main` at `b957624c` (2026-10-27).

Non-fatal: aquamarine's `CDRMRenderer` requires `EGL_EXT_platform_device` and logs `initMgpu: no renderer` / `Failed to update renderer state` per commit. It is the multi-GPU blit path; the device has one GPU.

## Result

- `Using: OpenGL ES 3.2 v1.g24p0-00eac0`, `Vendor: ARM`, `Renderer: Mali-G52`, GBM backend `armsoc`, surfaceless contexts, `EGL_IMG_context_priority` high.
- `hyprctl monitors`: `DSI-1` 1024x768@60.199 at 0x0 and `DSI-2` 1024x768@60.199 at 0x768, both `XRGB8888`, DPMS on.
- `grim` capture (1024×1536): `foot` on DSI-1, Hyprland wallpaper on DSI-2.
- libinput: `gt9xx-0` is a touchscreen; `adc-keys`, `dierct-keys-polled`, `rk805 pwrkey`, `headset-keys` are keyboards; `ANBERNIC-rk3568-keys` is a joystick and libinput ignores it.

## Memory

With Hyprland, `foot` and Xwayland running: Hyprland `RssAnon` 85 MB, `RssFile` 358 MB; the Mali driver reports 78 101 pages (305 MB) in Hyprland's GPU context (`/sys/kernel/debug/mali0/gpu_memory`). `MemAvailable` 435 MB of 976 MB.

## `egltest`

`egltest.c` repeats Hyprland's `initEGL` GBM sequence outside Hyprland. On `/dev/dri/renderD128` as user `omarchy`, every variant (GLES 3.2, 3.0, with `IMG_context_priority`, with `EXT_create_context_robustness`, both) creates a context, makes it current without a surface, and reports `GL_EXT_texture_format_BGRA8888`.
