# USB debug link

The RG DS Plus kernel has no USB network function (`CONFIG_USB_CONFIGFS_RNDIS`, `ECM`, `NCM` are unset) and no PPP, SLIP or TUN, so IP cannot run over USB. The link instead carries TCP connections inside frames over a vendor-class bulk interface:

```
Mac: ssh -p 2222 ──TCP──▶ usb-mux.ts ──libusb bulk──▶ USB ──FunctionFS──▶ usbmux.py ──TCP──▶ 127.0.0.1:22 (sshd)
```

## Use

On the device (as root, any time after boot; it is not started at boot yet):

```sh
scp tools/usb-link/usbmux.py root@192.168.8.175:/tmp/
ssh root@192.168.8.175 'setsid python3 /tmp/usbmux.py >/tmp/usbmux.log 2>&1 </dev/null &'
```

On the Mac (needs `brew install libusb`):

```sh
bun tools/usb-link/usb-mux.ts 2222:22 [local:remote …]
ssh -p 2222 -o HostKeyAlias=192.168.8.175 root@127.0.0.1
```

`HostKeyAlias` makes ssh check the key it already stored for the Wi-Fi address, so the USB path is verified against the same sshd. Each `local:remote` pair forwards Mac `127.0.0.1:local` to device `127.0.0.1:remote`; ssh `-L`/`-R` and `ControlMaster` also work through the one SSH connection.

## Gadget

`usbmux.py` builds configfs gadget `/sys/kernel/config/usb_gadget/pocket` on UDC `fcc00000.usb` (the DWC3 OTG controller, already in device mode):

- VID:PID `1d6b:0104`, serial `rgdsplus`, product `RG DS Plus Pocket Debug`.
- `acm.usb0`: CDC ACM serial (`/dev/ttyGS0` on the device, `/dev/cu.usbmodemrgdsplus1` on the Mac). Not used by the link; kept as a console.
- `ffs.pocket`: FunctionFS mounted at `/dev/usb-ffs/pocket`, one interface of class `0xFF` subclass `0x50` with one bulk IN and one bulk OUT endpoint. macOS binds no driver to it, so libusb claims it without a kext.

FunctionFS needs its descriptors written to `ep0` before the UDC is bound, and closing `ep0` unbinds the whole gadget. The daemon therefore owns the gadget: it unbinds, writes descriptors, binds, and holds `ep0` open for its lifetime.

## Protocol

Frame: `0xA5 | type u8 | channel u16 BE | length u16 BE | payload` (payload ≤ 16384 bytes).

| Type | Direction | Meaning |
|---|---|---|
| `R` | both | reset; the device closes every channel and echoes the 8-byte nonce |
| `O` | Mac → device | open channel to the device port in the payload (u16 BE); the device answers `O` or `C` |
| `D` | both | channel data |
| `C` | both | channel closed |

- A transfer whose length is a multiple of 512 gets one trailing `0x00` byte, so it ends with a short packet and the reader's request completes. Parsers skip bytes outside frames.
- On start the Mac sends 16 390 zero bytes (one maximum frame) and then `R` with a random nonce, and drops every frame until the matching `R` comes back. This resynchronises a device parser that stopped inside a frame and discards data queued for a previous host process.
- Channel ids count up to 65535 before they wrap, so a late `D` or `C` for a closed channel never reaches a new one.
- Backpressure: the Mac pauses its TCP sockets while more than 1 MiB waits for the USB writer, and the reader thread stops issuing bulk-in transfers while more than 1 MiB of received data waits for a backed-up socket. The device writes with blocking calls, one thread per channel.

## Measurements (2026-10-29, Apple M3 Mac, USB 2.0 high speed)

| | USB link | Wi-Fi (same AP) |
|---|---|---|
| 64 MiB `ssh 'cat >'` upload | 15.7 MiB/s | 8.1 MiB/s |
| 64 MiB `ssh 'cat'` download | 18.0 MiB/s | 9.5 MiB/s |
| `ssh -o ControlPath=… true`, mean of 30 | 19.5 ms | 70 ms |

5 rounds of 64 MiB up and down (640 MiB) completed with matching sha256 and no stall. With `nmcli radio wifi off` on the device, the Mac could not ping it and the USB link still ran commands and moved an 8 MiB file with a matching sha256.

## Why not the ACM serial port

The ACM function alone gives `/dev/cu.usbmodemrgdsplus1`: 1-byte round trip p50 0.16 ms, 8 MiB echo at 16 MiB/s each way. A device-to-Mac stream through it stopped after 23 to 56 MB in three of four 64 MiB runs:

- the device thread was blocked in `n_tty_write` on `/dev/ttyGS0`;
- the device's bulk IN TRB ring (`/sys/kernel/debug/usb/fcc00000.usb/ep1in/trb_ring`) held 512-byte TRBs with `hwo=1`, data handed to the controller and waiting for the host;
- the Mac reader thread was blocked in `read()` with zero bytes in flight and every local socket empty.

Reopening the port restarts the stream and drops the session. Polling the tty from the event loop instead (non-blocking reads, 1 ms waits) lost bytes: macOS tty queues hold about 1 KB, and SSH failed with `message authentication code incorrect`. The FunctionFS + libusb path uses the same DWC3 controller and does not stall, which places the fault in the macOS CDC ACM / tty path.

## Other traps

- configfs `UDC`: writing `""` from Python is a zero-byte write and leaves the gadget bound; write `"\n"` to unbind.
- An ssh `ControlPath` longer than 104 bytes fails (`unix_listener: path … too long`); use a short relative path.
