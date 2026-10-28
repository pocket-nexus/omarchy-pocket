#!/usr/bin/env python3
# Device side of the USB debug link on the RG DS Plus. Binds a gadget on the OTG
# port with an ACM console plus a vendor FunctionFS interface (class 0xFF/0x50),
# and multiplexes TCP connections to 127.0.0.1:<port> over its two bulk endpoints.
# Frame: 0xA5 | type u8 | channel u16 BE | length u16 BE | payload
# A transfer whose length is a multiple of 512 gets one 0x00 byte so it ends in a
# short packet; the parser skips bytes outside frames.
import os, socket, struct, threading, time

UDC = "fcc00000.usb"
GADGET = "/sys/kernel/config/usb_gadget/pocket"
FFS = "/dev/usb-ffs/pocket"
MAGIC, MAXP = 0xA5, 16384
RESET, OPEN, DATA, CLOSE = 0x52, 0x4F, 0x44, 0x43


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


def put(path, value):
    with open(path, "w") as f:
        f.write(value)


def descriptors():
    def interface():
        return struct.pack("<9B", 9, 4, 0, 0, 2, 0xFF, 0x50, 0x01, 1)

    def endpoint(addr, mps):
        return struct.pack("<BBBBHB", 7, 5, addr, 2, mps, 0)

    fs = interface() + endpoint(0x81, 64) + endpoint(0x02, 64)
    hs = interface() + endpoint(0x81, 512) + endpoint(0x02, 512)
    body = struct.pack("<II", 3, 3) + fs + hs  # fs_count, hs_count
    descs = struct.pack("<III", 3, 12 + len(body), 1 | 2) + body  # MAGIC_V2, length, HAS_FS|HAS_HS
    text = struct.pack("<H", 0x0409) + b"Pocket Debug\0"
    strings = struct.pack("<IIII", 2, 16 + len(text), 1, 1) + text  # STRINGS_MAGIC, length, str, lang
    return descs, strings


def setup():
    if os.path.exists(GADGET + "/UDC") and open(GADGET + "/UDC").read().strip():
        put(GADGET + "/UDC", "\n")
    for d in ("strings/0x409", "configs/c.1/strings/0x409", "functions/acm.usb0", "functions/ffs.pocket"):
        os.makedirs(f"{GADGET}/{d}", exist_ok=True)
    for name, value in (("idVendor", "0x1d6b"), ("idProduct", "0x0104"), ("bcdDevice", "0x0100"),
                        ("bcdUSB", "0x0200"), ("bDeviceClass", "0xEF"), ("bDeviceSubClass", "0x02"),
                        ("bDeviceProtocol", "0x01"), ("strings/0x409/serialnumber", "rgdsplus"),
                        ("strings/0x409/manufacturer", "Anbernic"),
                        ("strings/0x409/product", "RG DS Plus Pocket Debug"),
                        ("configs/c.1/strings/0x409/configuration", "ACM+FFS"), ("configs/c.1/MaxPower", "250")):
        put(f"{GADGET}/{name}", value)
    for fn in ("acm.usb0", "ffs.pocket"):
        if not os.path.exists(f"{GADGET}/configs/c.1/{fn}"):
            os.symlink(f"{GADGET}/functions/{fn}", f"{GADGET}/configs/c.1/{fn}")
    os.makedirs(FFS, exist_ok=True)
    if not os.path.exists(FFS + "/ep0"):
        os.system(f"mount -t functionfs pocket {FFS}")
    ep0 = os.open(FFS + "/ep0", os.O_RDWR)
    for blob in descriptors():
        os.write(ep0, blob)
    put(GADGET + "/UDC", UDC)
    return ep0, os.open(FFS + "/ep1", os.O_RDWR), os.open(FFS + "/ep2", os.O_RDWR)


ep0, ep_in, ep_out = setup()
write_lock = threading.Lock()
chans_lock = threading.Lock()
chans = {}  # channel -> socket


def events():
    names = ("bind", "unbind", "enable", "disable", "setup", "suspend", "resume")
    while True:
        ev = os.read(ep0, 12 * 8)
        for i in range(0, len(ev), 12):
            kind = ev[i + 8]
            log("usb", names[kind] if kind < len(names) else kind)
            if kind == 4:  # no class/vendor requests: stall by doing the opposite direction
                try:
                    os.read(ep0, 0) if ev[i] & 0x80 else os.write(ep0, b"")
                except OSError:
                    pass


def send(kind, ch, payload=b""):
    off = 0
    while True:
        chunk = payload[off:off + MAXP]
        buf = bytes((MAGIC, kind, ch >> 8, ch & 0xFF, len(chunk) >> 8, len(chunk) & 0xFF)) + chunk
        if len(buf) % 512 == 0:
            buf += b"\0"
        with write_lock:
            os.write(ep_in, buf)
        off += MAXP
        if off >= len(payload):
            return


def pump(ch, s):
    try:
        while data := s.recv(MAXP):
            send(DATA, ch, data)
    except OSError:
        pass
    with chans_lock:
        mine = chans.get(ch) is s
        if mine:
            del chans[ch]
    s.close()
    if mine:
        log("close", ch)
        try:
            send(CLOSE, ch)
        except OSError:
            pass


def drop(ch):
    with chans_lock:
        s = chans.pop(ch, None)
    if s:
        try:
            s.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def handle(kind, ch, payload):
    if kind == RESET:
        for c in list(chans):
            drop(c)
        log("reset")
        send(RESET, 0, payload)
    elif kind == OPEN:
        drop(ch)
        try:
            port = int.from_bytes(payload, "big")
            s = socket.create_connection(("127.0.0.1", port), timeout=2)
            s.settimeout(None)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except (OSError, ValueError) as e:
            log("open failed", ch, payload.hex(), e)
            send(CLOSE, ch)
            return
        with chans_lock:
            chans[ch] = s
        send(OPEN, ch)
        log("open", ch, port)
        threading.Thread(target=pump, args=(ch, s), daemon=True).start()
    elif kind == DATA:
        s = chans.get(ch)
        if s:
            try:
                s.sendall(payload)
            except OSError:
                drop(ch)
    elif kind == CLOSE:
        drop(ch)


threading.Thread(target=events, daemon=True).start()
log("ready on", FFS)
rx = bytearray()
while True:
    try:
        rx += os.read(ep_out, 32768)
    except OSError as e:  # host gone: drop every channel and wait for the next enable
        log("ep out", e)
        for c in list(chans):
            drop(c)
        rx.clear()
        time.sleep(0.2)
        continue
    while True:
        i = rx.find(MAGIC)
        if i < 0:
            rx.clear()
            break
        del rx[:i]
        if len(rx) < 6:
            break
        n = (rx[4] << 8) | rx[5]
        if n > MAXP or rx[1] not in (RESET, OPEN, DATA, CLOSE):
            del rx[:1]  # not a header: resync on the next magic byte
            continue
        if len(rx) < 6 + n:
            break
        kind, ch, payload = rx[1], (rx[2] << 8) | rx[3], bytes(rx[6:6 + n])
        del rx[:6 + n]
        try:
            handle(kind, ch, payload)
        except OSError as e:
            log("handle", e)
