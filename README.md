# pocket-rgds

Bring-up notes and tools for the Anbernic RG DS Plus (RK3568, two 1024×768 DSI panels), and the work to run Omarchy on it.

- [docs/device.md](docs/device.md): hardware, partitions, boot chain, kernel and GPU stack of the stock firmware.
- [docs/usb-link.md](docs/usb-link.md): SSH and port forwarding from a Mac over the OTG USB port, with measurements.
- `tools/usb-link/`: `usbmux.py` (device daemon) and `usb-mux.ts` (Mac bridge, Bun + libusb).
