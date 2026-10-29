// org.freedesktop.Notifications on the Omarchy user's session bus, the server
// Omarchy's `omarchy-notification-send` calls (busctl Notify with its
// omarchy-glyph, omarchy-exec-argv and omarchy-actions hints) and any other
// program reaches through libnotify. Notices go to the shell as events; the
// shell asks for a notice's command to run or for it to close.
import dbus from "dbus-next";
import type { Notice } from "./protocol.ts";

const PATH = "/org/freedesktop/Notifications";
const NAME = "org.freedesktop.Notifications";
const DO_NOT_QUEUE = 4;
/** An expire timeout of -1 means the server's choice; critical notices stay. */
const DEFAULT_MS = 5000;
const KEEP = 50;
/** NotificationClosed reasons */
export const CLOSED = { expired: 1, dismissed: 2, called: 3 } as const;

export interface NoticeEvents {
  shown(notice: Notice): void;
  closed(id: number, reason: number): void;
}

type Hints = Record<string, { value: unknown }>;

/** A notice with what invoking it runs: Omarchy's argv hints, or the D-Bus
 *  action keys a libnotify program waits for. */
interface Stored extends Notice {
  argv: string[] | null;
  actionArgv: string[][];
  dbusActions: string[];
}

const { Interface } = dbus.interface;

function argv(json: unknown): string[] | null {
  try {
    const value = JSON.parse(String(json));
    return Array.isArray(value) && value.every((w) => typeof w === "string") && value.length ? value : null;
  } catch {
    return null;
  }
}

export class Notifications {
  private readonly notices = new Map<number, Stored>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;
  private service: InstanceType<typeof Interface> | null = null;

  constructor(private readonly events: NoticeEvents) {}

  async start() {
    const owner = this;
    class Service extends Interface {
      Notify(app: string, replaces: number, icon: string, summary: string, body: string, actions: string[], hints: Hints, timeout: number) {
        return owner.notify(app, replaces, icon, summary, body, actions, hints, timeout);
      }
      CloseNotification(id: number) {
        owner.close(id, CLOSED.called);
      }
      GetCapabilities() {
        return ["body", "actions", "persistence"];
      }
      GetServerInformation() {
        return ["Omarchy Pocket", "pocket-nexus", "0.1.0", "1.2"];
      }
      NotificationClosed(id: number, reason: number) {
        return [id, reason];
      }
      ActionInvoked(id: number, key: string) {
        return [id, key];
      }
    }
    Service.configureMembers({
      methods: {
        Notify: { inSignature: "susssasa{sv}i", outSignature: "u" },
        CloseNotification: { inSignature: "u", outSignature: "" },
        GetCapabilities: { inSignature: "", outSignature: "as" },
        GetServerInformation: { inSignature: "", outSignature: "ssss" },
      },
      signals: {
        NotificationClosed: { signature: "uu" },
        ActionInvoked: { signature: "us" },
      },
    });
    const bus = dbus.sessionBus();
    this.service = new Service(NAME);
    bus.export(PATH, this.service);
    const reply = await bus.requestName(NAME, DO_NOT_QUEUE);
    if (reply !== 1) throw new Error(`${NAME} is owned by another program (requestName ${reply})`);
  }

  private notify(app: string, replaces: number, icon: string, summary: string, body: string, actions: string[], hints: Hints, timeout: number): number {
    const id = replaces && this.notices.has(replaces) ? replaces : this.nextId++;
    const urgency = Number(hints.urgency?.value ?? 1);
    // omarchy-actions: [{label, argv}]; plain D-Bus actions: [key, label, key, label, ...]
    const omarchyActions = (() => {
      try {
        const list = JSON.parse(String(hints["omarchy-actions"]?.value ?? "[]")) as { label: string; argv: string[] }[];
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    })();
    const labels = omarchyActions.length
      ? omarchyActions.map((a) => a.label)
      : actions.filter((_, i) => i % 2 === 1);
    const notice: Stored = {
      id,
      app,
      summary,
      body: body.replace(/<[^>]*>/g, ""),
      glyph: String(hints["omarchy-glyph"]?.value ?? ""),
      icon,
      urgency,
      actions: labels,
      argv: argv(hints["omarchy-exec-argv"]?.value),
      actionArgv: omarchyActions.map((a) => a.argv),
      dbusActions: omarchyActions.length ? [] : actions.filter((_, i) => i % 2 === 0),
    };
    this.notices.set(id, notice);
    while (this.notices.size > KEEP) this.notices.delete(this.notices.keys().next().value!);
    const ms = timeout < 0 ? (urgency === 2 ? 0 : DEFAULT_MS) : timeout;
    clearTimeout(this.timers.get(id));
    if (ms > 0) this.timers.set(id, setTimeout(() => this.close(id, CLOSED.expired), ms));
    this.events.shown(this.public(notice));
    return id;
  }

  private public(n: Stored): Notice {
    return { id: n.id, app: n.app, summary: n.summary, body: n.body, glyph: n.glyph, icon: n.icon, urgency: n.urgency, actions: n.actions };
  }

  close(id: number, reason: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (!this.notices.has(id)) return;
    // expired notices stay in the list for the history; dismissed ones go
    if (reason !== CLOSED.expired) this.notices.delete(id);
    (this.service as unknown as { NotificationClosed(id: number, reason: number): void } | null)?.NotificationClosed(id, reason);
    this.events.closed(id, reason);
  }

  /** Runs the notice's command (index -1) or one of its actions, then closes it. */
  invoke(id: number, index: number) {
    const notice = this.notices.get(id);
    if (!notice) throw new Error(`no notification ${id}`);
    const command = index < 0 ? notice.argv : notice.actionArgv[index];
    if (command) Bun.spawn(["setsid", "-f", ...command], { stdio: ["ignore", "ignore", "ignore"] });
    else {
      const key = index < 0 ? "default" : notice.dbusActions[index];
      if (key) (this.service as unknown as { ActionInvoked(id: number, key: string): void } | null)?.ActionInvoked(id, key);
    }
    this.close(id, CLOSED.dismissed);
  }

  list(): Notice[] {
    return [...this.notices.values()].map((n) => this.public(n)).reverse();
  }
}
