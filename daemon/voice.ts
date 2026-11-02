// Voice input: the RK817's main microphone through arecord, recognized on the
// device by a Paraformer model (asr/pocket-asr.c) with no network. Recording opens
// the codec's capture path and closing it turns the path off again. The recognizer
// takes about 145 MB, so it starts with the first recording and exits IDLE_MS after
// the last. A recording stops by itself at MAX_SECONDS.
import { existsSync } from "node:fs";

const ASR = "/usr/lib/omarchy-pocket/asr";
const RATE = 16000;
const MAX_SECONDS = 60;
const IDLE_MS = 5 * 60 * 1000;
/** Under this many samples a press was a slip: a third of a second. */
const SHORTEST = RATE / 3;
/** The analog gain that keeps speech at arm's length under clipping. */
const BOOST = "2";

export type VoiceReport = { state: "listening" | "decoding" | "idle"; level: number };

const amixer = (...args: string[]) => Bun.spawn(["amixer", "-q", "-c", "0", ...args], { stdout: "ignore", stderr: "ignore" }).exited;

/** The DC offset gone and the peak at 70% of full scale. Silence stays silence. */
export function condition(samples: Int16Array) {
  if (!samples.length) return;
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / samples.length;
  let peak = 1;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, samples[i]! - mean));
    samples[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak < 300) return;
  const gain = Math.min(12, 22000 / peak);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-32768, Math.min(32767, samples[i]! * gain));
}

class Recognizer {
  private child: Bun.Subprocess<"pipe", "pipe", "ignore"> | null = null;
  private lines: { buffered: string[]; waiting: ((line: string | null) => void) | null } = { buffered: [], waiting: null };
  private ready: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private nextLine(): Promise<string | null> {
    const line = this.lines.buffered.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => (this.lines.waiting = resolve));
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const child = Bun.spawn(["nice", "-n", "5", `${ASR}/pocket-asr`, `${ASR}/model`], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, LD_LIBRARY_PATH: `${ASR}/lib` },
    });
    this.child = child;
    this.lines = { buffered: [], waiting: null };
    const lines = this.lines;
    void (async () => {
      const decoder = new TextDecoder();
      let partial = "";
      for await (const chunk of child.stdout) {
        partial += decoder.decode(chunk, { stream: true });
        for (let at = partial.indexOf("\n"); at >= 0; at = partial.indexOf("\n")) {
          const line = partial.slice(0, at);
          partial = partial.slice(at + 1);
          if (lines.waiting) {
            lines.waiting(line);
            lines.waiting = null;
          } else lines.buffered.push(line);
        }
      }
      lines.waiting?.(null);
      lines.waiting = null;
      if (this.child === child) {
        this.child = null;
        this.ready = null;
      }
    })();
    this.ready = this.nextLine().then((line) => {
      if (line !== "ready") {
        this.ready = null;
        throw new Error("the recognizer did not start");
      }
    });
    return this.ready;
  }

  /** Keeps the model loaded through the next recording. */
  warm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.start().catch(() => {});
  }

  async decode(samples: Int16Array): Promise<string> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("the recognizer exited");
    const head = new Uint32Array([samples.length]);
    child.stdin.write(new Uint8Array(head.buffer));
    child.stdin.write(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    child.stdin.flush();
    const line = await this.nextLine();
    if (line === null) throw new Error("the recognizer exited");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), IDLE_MS);
    return line.trim();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}

export class Voice {
  private recognizer = new Recognizer();
  private recording: { child: Bun.Subprocess<"ignore", "pipe", "ignore">; chunks: Int16Array[]; done: Promise<void>; count: number } | null = null;
  private decoding = false;

  constructor(private report: (state: VoiceReport) => void) {}

  available() {
    return existsSync(`${ASR}/pocket-asr`) && existsSync(`${ASR}/model/model.int8.onnx`);
  }

  async start(): Promise<void> {
    if (this.recording || this.decoding) return;
    if (!this.available()) throw new Error("The voice model is not installed");
    await amixer("cset", "name=Capture MIC Path", "Main Mic");
    await amixer("sset", "MIC Boost Gain", BOOST);
    this.recognizer.warm();
    const child = Bun.spawn(["arecord", "-q", "-D", "hw:0,0", "-f", "S16_LE", "-c", "2", "-r", String(RATE), "-t", "raw", "-d", String(MAX_SECONDS)], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const chunks: Int16Array[] = [];
    const recording = { child, chunks, count: 0, done: Promise.resolve() };
    this.recording = recording;
    this.report({ state: "listening", level: 0 });
    recording.done = (async () => {
      let carry = new Uint8Array(0);
      let mean = 0;
      let lastReport = 0;
      for await (const chunk of child.stdout) {
        const bytes = new Uint8Array(carry.length + chunk.length);
        bytes.set(carry);
        bytes.set(chunk, carry.length);
        const frames = Math.floor(bytes.length / 4);
        carry = bytes.slice(frames * 4);
        const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 4);
        // the microphone is the left channel; the right is silent
        const left = new Int16Array(frames);
        let peak = 0;
        for (let i = 0; i < frames; i++) {
          const s = view.getInt16(i * 4, true);
          left[i] = s;
          mean += (s - mean) * 0.001;
          peak = Math.max(peak, Math.abs(s - mean));
        }
        chunks.push(left);
        recording.count += frames;
        const now = Date.now();
        if (this.recording === recording && now - lastReport >= 100) {
          lastReport = now;
          this.report({ state: "listening", level: Math.min(1, peak / 12000) });
        }
      }
    })();
    // arecord reached its limit: what it heard still counts
    void child.exited.then(() => {
      if (this.recording === recording) this.onLimit?.();
    });
  }

  /** Called when a recording ends at MAX_SECONDS. */
  onLimit: (() => void) | null = null;

  private async endRecording(): Promise<Int16Array> {
    const recording = this.recording;
    if (!recording) return new Int16Array(0);
    this.recording = null;
    recording.child.kill();
    await recording.child.exited;
    await recording.done;
    await amixer("cset", "name=Capture MIC Path", "MIC OFF");
    const all = new Int16Array(recording.count);
    let at = 0;
    for (const chunk of recording.chunks) {
      all.set(chunk, at);
      at += chunk.length;
    }
    return all;
  }

  /** Ends the recording and returns what was said; "" when nothing was. */
  async stop(): Promise<string> {
    const samples = await this.endRecording();
    if (samples.length < SHORTEST) {
      this.report({ state: "idle", level: 0 });
      return "";
    }
    condition(samples);
    this.decoding = true;
    this.report({ state: "decoding", level: 0 });
    try {
      return await this.recognizer.decode(samples);
    } finally {
      this.decoding = false;
      this.report({ state: "idle", level: 0 });
    }
  }

  async cancel() {
    await this.endRecording();
    this.report({ state: "idle", level: 0 });
  }

  shutdown() {
    this.recording?.child.kill();
    this.recognizer.stop();
  }
}
