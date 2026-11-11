// An input device's events, read beside the host program (which never grabs
// its devices). A read stream on /dev/input/event* holds one of Bun's pool
// threads in a blocking read for as long as the device is open, and the pool
// also resolves host names: with a handful of devices open (the uConsole's
// keyboard, joystick, consumer keys and power key) the daemon's fetches waited
// for DNS forever. `cat` reads the device instead, and its stdout is a pipe
// the event loop polls.
const EVENT_BYTES = 24;

export interface DeviceReader {
  stop(): void;
}

/** Calls `events` with whole input_event records from `path` until it goes
 *  away or stop(); `gone` when it does. */
export function readDevice(path: string, events: (data: Buffer) => void, gone: (code: number | null) => void): DeviceReader {
  const child = Bun.spawn(["cat", path], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  let stopped = false;
  void (async () => {
    let rest = Buffer.alloc(0);
    try {
      for await (const chunk of child.stdout) {
        const data = rest.length ? Buffer.concat([rest, Buffer.from(chunk)]) : Buffer.from(chunk);
        const whole = data.length - (data.length % EVENT_BYTES);
        rest = data.subarray(whole);
        if (whole) events(data.subarray(0, whole));
      }
    } catch {}
    const code = await child.exited;
    if (!stopped) gone(code);
  })();
  return {
    stop() {
      stopped = true;
      child.kill();
    },
  };
}
