// Soloist's local WebSocket API (developer.spotify.com/documentation/soloist/
// reference/websocket-api), the way this device plays on its own: Soloist runs
// with `--ws 127.0.0.1:0` and logs "websocket server listening on <addr>";
// this link connects there, keeps the state its events carry, and sends the
// commands. A command answers {"type":"command_result"} when Soloist has
// dispatched it, or {"type":"error","message"}; what playback became arrives
// as events. Queries (get_state, get_queue, get_auth_state) answer with their
// event instead.

export interface SoloistEntity {
  uri: string;
  kind: string;
  title: string;
  subtitle: string;
  image: string;
  durationMs: number | null;
  explicit: boolean;
  album: { uri: string; title: string } | null;
  artists: { uri: string; title: string }[];
}

export interface SoloistState {
  connected: boolean;
  loggedIn: boolean;
  /** the account's active Connect device is this one */
  active: boolean;
  status: "idle" | "playing" | "paused" | "buffering";
  item: SoloistEntity | null;
  context: SoloistEntity | null;
  /** position_ms at timestamp_ms (Unix ms), moving at speed */
  position: { ms: number; at: number; speed: number } | null;
  volume: number | null;
  shuffle: boolean;
  repeat: "off" | "context" | "track";
  upcoming: SoloistEntity[];
}

type Json = any;

const name = (e: Json): string => String(e?.decorations?.identity?.name ?? e?.name ?? "");

/** An entity of the API as the applet's fields need it. */
export function entity(e: Json): SoloistEntity | null {
  if (!e || typeof e !== "object") return null;
  const uri = String(e.uri ?? "");
  const d = e.decorations ?? {};
  const covers: Json[] = Array.isArray(d.visual_identity?.cover) ? d.visual_identity.cover : [];
  const cover = ["default", "large", "small", "xlarge"].map((size) => covers.find((c) => c?.size === size)?.url).find((u) => typeof u === "string") ?? covers[0]?.url ?? "";
  const creators: Json[] = Array.isArray(d.creators) ? d.creators : [];
  const artists = creators.map((c) => ({ uri: String(c?.uri ?? c?.entity?.uri ?? ""), title: name(c?.entity ?? c) })).filter((a) => a.title);
  const parent = d.parent?.entity ?? d.parent ?? null;
  const ratings: unknown[] = Array.isArray(d.playback?.content_ratings) ? d.playback.content_ratings : [];
  if (!uri && !name(e)) return null;
  return {
    uri,
    kind: String(e.entity_type ?? uri.split(":")[1] ?? ""),
    title: name(e),
    subtitle: artists.map((a) => a.title).join(", "),
    image: String(cover),
    durationMs: typeof d.playback?.duration_ms === "number" ? d.playback.duration_ms : null,
    explicit: ratings.some((r) => String(r).toLowerCase() === "explicit"),
    album: parent && (parent.uri || name(parent)) ? { uri: String(parent.uri ?? ""), title: name(parent) } : null,
    artists,
  };
}

const initial = (): SoloistState => ({ connected: false, loggedIn: false, active: false, status: "idle", item: null, context: null, position: null, volume: null, shuffle: false, repeat: "off", upcoming: [] });

export class SoloistLink {
  state: SoloistState = initial();
  /** how many state events have arrived: a command's effect is the next one */
  events = 0;
  private socket: WebSocket | null = null;
  private address = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiting: { command: string; resolve: (v: Json) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private closed = true;

  constructor(private readonly options: { onChange?: () => void; log?: (line: string) => void }) {}

  /** Connect to `address` (host:port) and stay connected until close(). */
  open(address: string) {
    if (this.address === address && this.socket) return;
    this.closeSocket();
    this.address = address;
    this.closed = false;
    this.connect();
  }

  close() {
    this.closed = true;
    this.address = "";
    this.closeSocket();
    this.state = initial();
    this.options.onChange?.();
  }

  private closeSocket() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // already closed
    }
    for (const w of this.waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error("Soloist closed its connection"));
    }
  }

  private connect() {
    if (this.closed || !this.address) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://${this.address}`);
    } catch {
      this.again();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.state.connected = true;
      this.options.onChange?.();
    };
    socket.onmessage = (event) => this.received(String(event.data));
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.state.connected = false;
      for (const w of this.waiting.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error("Soloist closed its connection"));
      }
      this.options.onChange?.();
      this.again();
    };
    socket.onerror = () => {
      // onclose follows
    };
  }

  private again() {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, 1000);
  }

  private received(text: string) {
    let m: Json;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    const s = this.state;
    switch (m.type) {
      case "auth_state":
        s.loggedIn = m.logged_in === true;
        s.active = m.is_active === true;
        break;
      case "playback_state":
        s.loggedIn = true;
        if (typeof m.status === "string") s.status = m.status;
        s.item = entity(m.item);
        s.context = entity(m.context);
        this.position(m.position);
        if (typeof m.volume === "number") s.volume = m.volume;
        s.active = m.is_active === true;
        this.optionsFrom(m.options);
        break;
      case "track_changed":
        s.item = entity(m.item);
        break;
      case "playback_changed":
        if (typeof m.status === "string") s.status = m.status;
        break;
      case "volume_changed":
        if (typeof m.volume === "number") s.volume = m.volume;
        break;
      case "device_changed":
        s.active = m.is_active === true;
        break;
      case "context_changed":
        s.context = entity(m.context);
        break;
      case "options_changed":
        this.optionsFrom(m.options);
        break;
      case "position_sync":
        this.position(m.position);
        break;
      case "queue_changed":
        s.upcoming = (Array.isArray(m.upcoming) ? m.upcoming : []).map((q: Json) => entity(q?.item)).filter((e: SoloistEntity | null): e is SoloistEntity => e !== null);
        break;
    }
    // a reply: the first command waiting that this message answers
    const answers = m.type === "command_result" ? m.command : m.type === "error" ? "*" : { playback_state: "get_state", queue_changed: "get_queue", auth_state: "get_auth_state" }[m.type as string];
    if (answers) {
      const at = this.waiting.findIndex((w) => answers === "*" || w.command === answers);
      if (at >= 0) {
        const [w] = this.waiting.splice(at, 1);
        clearTimeout(w!.timer);
        if (m.type === "error") w!.reject(new Error(String(m.message ?? "Soloist refused the command")));
        else w!.resolve(m);
      }
    }
    if (m.type !== "command_result" && m.type !== "error") {
      this.events++;
      this.options.onChange?.();
    }
  }

  private position(p: Json) {
    if (p && typeof p.position_ms === "number") this.state.position = { ms: p.position_ms, at: typeof p.timestamp_ms === "number" ? p.timestamp_ms : Date.now(), speed: typeof p.speed === "number" ? p.speed : 1 };
  }

  private optionsFrom(o: Json) {
    if (!o || typeof o !== "object") return;
    if (typeof o.shuffle === "boolean") this.state.shuffle = o.shuffle;
    if (o.repeat === "off" || o.repeat === "context" || o.repeat === "track") this.state.repeat = o.repeat;
  }

  /** Where playback is now, in ms. */
  positionNow(now = Date.now()): number {
    const p = this.state.position;
    if (!p) return 0;
    const moving = this.state.status === "playing" ? Math.max(0, p.speed) : 0;
    return Math.max(0, Math.round(p.ms + Math.max(0, now - p.at) * moving));
  }

  /** Send a command; resolves on Soloist's command_result (or the query's event). */
  send(command: string, fields: Record<string, unknown> = {}, ms = 8000): Promise<Json> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Soloist is not running"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.waiting.findIndex((w) => w.timer === timer);
        if (at >= 0) this.waiting.splice(at, 1);
        reject(new Error(`Soloist did not answer ${command}`));
      }, ms);
      this.waiting.push({ command, resolve, reject, timer });
      socket.send(JSON.stringify({ type: "command", command, ...fields }));
    });
  }

  get ready(): boolean {
    return this.state.connected && this.state.loggedIn;
  }
}
