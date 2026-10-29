// Host side of the USB debug link: forwards local TCP ports to 127.0.0.1:<port>
// on the RG DS Plus through the vendor bulk interface usbmux.py exposes.
//   bun usb-mux.ts 2222:22 [local:remote ...]
// Frame: 0xA5 | type u8 | channel u16 BE | length u16 BE | payload
//
// libusb owns the interface (macOS binds no driver to class 0xFF); two worker
// threads sit in blocking bulk transfers, the main thread frames and forwards.
// A transfer whose length is a multiple of 512 gets one 0x00 byte so it ends in a
// short packet; the parser skips bytes outside frames.
//
// The process started from the command line supervises: it runs the link in a
// child and starts a new one whenever the child exits, which it does when the
// device leaves the bus (suspend, reboot, cable).
import net from "node:net";
import { dlopen, ptr } from "bun:ffi";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const VID = 0x1d6b, PID = 0x0104;
const MAGIC = 0xa5, MAXP = 16384;
const RESET = 0x52, OPEN = 0x4f, DATA = 0x44, CLOSE = 0x43;
const HIGH = 1 << 20;

const usb = () =>
  dlopen("/opt/homebrew/lib/libusb-1.0.dylib", {
    libusb_init: { args: ["ptr"], returns: "i32" },
    libusb_open_device_with_vid_pid: { args: ["ptr", "u16", "u16"], returns: "ptr" },
    libusb_claim_interface: { args: ["ptr", "i32"], returns: "i32" },
    libusb_control_transfer: { args: ["ptr", "u8", "u8", "u16", "u16", "ptr", "u16", "u32"], returns: "i32" },
    libusb_bulk_transfer: { args: ["ptr", "u8", "ptr", "i32", "ptr", "u32"], returns: "i32" },
    libusb_error_name: { args: ["i32"], returns: "cstring" },
  }).symbols;

if (!isMainThread) {
  const { role, handle, ep, credit } = workerData as {
    role: "read" | "write"; handle: number; ep: number; credit: SharedArrayBuffer;
  };
  const lib = usb();
  const got = new Int32Array(1);
  const inflight = new Int32Array(credit);
  if (role === "read") {
    const buf = new Uint8Array(65536);
    for (;;) {
      for (let v; (v = Atomics.load(inflight, 0)) > HIGH; ) Atomics.wait(inflight, 0, v, 100);
      const r = lib.libusb_bulk_transfer(handle, ep, ptr(buf), buf.length, ptr(got), 0);
      if (r !== 0) throw new Error(`bulk in: ${lib.libusb_error_name(r)}`);
      const ab = buf.slice(0, got[0]).buffer;
      Atomics.add(inflight, 0, got[0]);
      parentPort!.postMessage(ab, [ab]);
    }
  } else {
    parentPort!.on("message", (chunk: Uint8Array) => {
      let out = chunk;
      if (out.length % 512 === 0) (out = new Uint8Array(chunk.length + 1)).set(chunk);
      const r = lib.libusb_bulk_transfer(handle, ep, ptr(out), out.length, ptr(got), 0);
      if (r !== 0) throw new Error(`bulk out: ${lib.libusb_error_name(r)}`);
      parentPort!.postMessage(chunk.length);
    });
  }
} else if (!process.env.USB_MUX_LINK) {
  for (;;) {
    const link = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], {
      env: { ...process.env, USB_MUX_LINK: "1" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const code = await link.exited;
    console.error(`link ended (exit ${code}); reconnecting`);
    await Bun.sleep(1000);
  }
} else {
  const forwards = process.argv.slice(2).map((a) => a.split(":").map(Number) as [number, number]);
  if (!forwards.length) forwards.push([2222, 22]);

  const lib = usb();
  if (lib.libusb_init(null) !== 0) throw new Error("libusb_init failed");
  let handle: number | null;
  while (!(handle = lib.libusb_open_device_with_vid_pid(null, VID, PID) as number | null)) {
    console.error(`waiting for ${VID.toString(16)}:${PID.toString(16)} on USB`);
    await Bun.sleep(1000);
  }

  // find the vendor interface (class 0xFF, subclass 0x50) and its endpoints in the raw config descriptor
  const cfg = new Uint8Array(1024);
  const cfgLen = lib.libusb_control_transfer(handle, 0x80, 6, 0x0200, 0, ptr(cfg), cfg.length, 1000);
  let iface = -1, epIn = 0, epOut = 0;
  for (let o = 0, cur = -1; o + 1 < cfgLen && cfg[o]; o += cfg[o]) {
    if (cfg[o + 1] === 4) cur = cfg[o + 5] === 0xff && cfg[o + 6] === 0x50 ? cfg[o + 2] : -1;
    if (cfg[o + 1] === 4 && cur >= 0) iface = cur;
    if (cfg[o + 1] === 5 && cur >= 0) cfg[o + 2] & 0x80 ? (epIn = cfg[o + 2]) : (epOut = cfg[o + 2]);
  }
  if (iface < 0 || !epIn || !epOut) throw new Error("no Pocket Debug interface on the device");
  const claimed = lib.libusb_claim_interface(handle, iface);
  if (claimed !== 0) throw new Error(`claim interface ${iface}: ${lib.libusb_error_name(claimed)}`);

  const credit = new SharedArrayBuffer(4); // bytes the reader thread handed over and the main thread holds
  const inflight = new Int32Array(credit);
  const reader = new Worker(import.meta.path, { workerData: { role: "read", handle, ep: epIn, credit } });
  const writer = new Worker(import.meta.path, { workerData: { role: "write", handle, ep: epOut, credit } });
  for (const w of [reader, writer]) w.on("error", (e) => { console.error(e.message); process.exit(1); });
  const sockets = new Map<number, net.Socket>();

  // USB writer: frames batch per event-loop turn; TCP sources pause above HIGH queued bytes
  let queued = 0, batch: Uint8Array[] = [], batchBytes = 0;
  function enqueue(out: Uint8Array) {
    batch.push(out);
    batchBytes += out.length;
    queued += out.length;
    if (batch.length === 1) setImmediate(flush);
    if (queued > HIGH) for (const s of sockets.values()) s.pause();
  }
  function flush() {
    const buf = new Uint8Array(batchBytes);
    let o = 0;
    for (const b of batch) { buf.set(b, o); o += b.length; }
    batch = [];
    batchBytes = 0;
    writer.postMessage(buf, [buf.buffer]);
  }
  function frame(kind: number, ch: number, payload: Uint8Array = new Uint8Array(0)) {
    let off = 0;
    do {
      const chunk = payload.subarray(off, off + MAXP);
      const out = new Uint8Array(6 + chunk.length);
      out.set([MAGIC, kind, ch >> 8, ch & 0xff, chunk.length >> 8, chunk.length & 0xff]);
      out.set(chunk, 6);
      enqueue(out);
      off += MAXP;
    } while (off < payload.length);
  }
  writer.on("message", (n: number) => {
    queued -= n;
    if (queued <= HIGH) for (const s of sockets.values()) s.resume();
  });

  // USB reader: frames before our reset echo are stale and dropped; read credit
  // returns to the reader thread only while no local socket is backed up
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(8)));
  let synced = false;
  let onSync = () => {};
  let held = 0;
  function release() {
    if ([...sockets.values()].some((s) => s.writableLength > HIGH)) return;
    Atomics.sub(inflight, 0, held);
    Atomics.notify(inflight, 0);
    held = 0;
  }

  function handle_(kind: number, ch: number, payload: Buffer) {
    if (kind === RESET) {
      if (payload.equals(nonce)) { synced = true; onSync(); }
      return;
    }
    if (!synced) return;
    const s = sockets.get(ch);
    if (kind === DATA) s?.write(payload);
    else if (kind === CLOSE && s) { sockets.delete(ch); s.end(); }
  }

  let rx = Buffer.alloc(0);
  reader.on("message", (ab: ArrayBuffer) => {
    rx = Buffer.concat([rx, new Uint8Array(ab)]);
    for (;;) {
      const i = rx.indexOf(MAGIC);
      if (i < 0) { rx = Buffer.alloc(0); break; }
      rx = rx.subarray(i);
      if (rx.length < 6) break;
      const len = rx.readUInt16BE(4);
      if (len > MAXP || ![RESET, OPEN, DATA, CLOSE].includes(rx[1])) { rx = rx.subarray(1); continue; }
      if (rx.length < 6 + len) break;
      const kind = rx[1], ch = rx.readUInt16BE(2), payload = Buffer.from(rx.subarray(6, 6 + len));
      rx = rx.subarray(6 + len);
      handle_(kind, ch, payload);
    }
    held += ab.byteLength;
    release();
  });

  // zeros flush any frame the device was halfway through, then the reset closes its channels
  for (;;) {
    const acked = new Promise<boolean>((resolve) => { onSync = () => resolve(true); setTimeout(() => resolve(false), 2000); });
    enqueue(new Uint8Array(MAXP + 6));
    frame(RESET, 0, nonce);
    if (await acked) break;
    console.error("waiting for usbmux.py to answer");
  }

  let nextCh = 0;
  function allocate() {
    do nextCh = (nextCh % 0xffff) + 1; while (sockets.has(nextCh));
    return nextCh;
  }

  for (const [local, remote] of forwards) {
    const port = Buffer.alloc(2);
    port.writeUInt16BE(remote);
    net.createServer((s) => {
      const ch = allocate();
      sockets.set(ch, s);
      s.setNoDelay(true);
      frame(OPEN, ch, port);
      s.on("data", (d: Buffer) => frame(DATA, ch, d));
      s.on("drain", release);
      const close = () => { if (sockets.get(ch) === s) { sockets.delete(ch); frame(CLOSE, ch); release(); } };
      s.on("end", close);
      s.on("error", close);
      s.on("close", close);
    }).listen(local, "127.0.0.1", () => console.error(`127.0.0.1:${local} -> device 127.0.0.1:${remote} over USB interface ${iface} (in 0x${epIn.toString(16)}, out 0x${epOut.toString(16)})`));
  }
}
