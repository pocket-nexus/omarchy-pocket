# Omarchy Pocket

Omarchy's CLI, themes, config and Linux services on the Anbernic RG DS Plus (RK3568, two 1024×768 DSI panels), under one PocketJS shell rendered by the Mali-G52. Omarchy's desktop session (Hyprland, Quickshell, SDDM) is not installed.

- [docs/omarchy-pocket.md](docs/omarchy-pocket.md): boot chain, card layout, system image, device program, input, power, network, shell.
- [docs/device.md](docs/device.md): hardware, partitions, boot chain, kernel and GPU stack of the stock firmware.
- [docs/usb-link.md](docs/usb-link.md): SSH and port forwarding from a Mac over the OTG USB port, with measurements.
- [docs/hyprland-on-libmali.md](docs/hyprland-on-libmali.md): Omarchy's Hyprland on the stock kernel through libmali (the first approach, kept as a record).

| Path | Contents |
|---|---|
| `shell/` | the PocketJS shell (Solid) |
| `tools/omarchy-assets.ts` | Omarchy's menu, theme, wallpaper and fonts for the shell, from the pinned rc packages |
| `image/build-root.ts`, `image/install.ts` | the system image and its installer |
| `device/` | files for the Omarchy root (`rootfs/`) and the stock root (`stock/`: boot chooser, rescue USB link) |
| `pkg/omarchy-pocket-headless/` | provides Omarchy's desktop-session dependencies |
| `tools/usb-link/` | `usbmux.py` (device) and `usb-mux.ts` (Mac, Bun + libusb) |
| `experiments/hyprland-libmali/` | the Hyprland spike and the patched Hyprland package |

The device program lives in pocketjs (`programs/rg-ds-plus`, branch `rg-ds-plus-usb-ssh-350b52c9` of pocket-nexus/pocketjs, commit `ee0f92a3`). `vendor/pocketjs` (ignored) points at a checkout of that commit; the shell and `tools/omarchy-assets.ts` import from it, and its tools need Bun 1.4.2.
