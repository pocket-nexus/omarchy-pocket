// The bar's and the idle settings in Omarchy's ~/.config/omarchy/shell.json, which
// Omarchy's Quickshell watches: `omarchy-bar position|background` edit the
// file, `omarchy-bar set` asks the shell to (setBarWidget, served here), and
// `omarchy-toggle-bar` flips ~/.local/state/omarchy/toggles/bar-off and calls
// `omarchy.bar syncHidden`.
import { existsSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BarSettings, IdleSettings } from "./protocol.ts";

interface Widget {
  id: string;
  [key: string]: unknown;
}
interface ShellConfig {
  idle?: { screensaver?: number; lock?: number };
  bar?: { position?: string; background?: string; transparent?: boolean; layout?: Record<string, Widget[]> };
}

export class Bar {
  readonly file: string;
  private readonly hiddenFlag: string;

  private readonly state: string;

  constructor(home: string) {
    this.file = join(home, ".config", "omarchy", "shell.json");
    this.state = join(home, ".local", "state", "omarchy");
    this.hiddenFlag = join(this.state, "toggles", "bar-off");
  }

  /** Omarchy's idle settings (hypridle's timeouts on a desktop), in seconds.
   *  The idle lock is off unless shell.json sets `idle.lock`: the handheld's
   *  user keeps the image's password, and a lock after 300 s of a game pad
   *  at rest (Omarchy's desktop default) shuts its owner out. Omarchy's Lock
   *  and the lock before suspend stay. */
  idle(): IdleSettings {
    const idle = this.config().idle ?? {};
    return {
      screensaver: idle.screensaver ?? 150,
      lock: idle.lock ?? 0,
      screensaverOff: existsSync(join(this.state, "toggles", "screensaver-off")),
      stayAwake: existsSync(join(this.state, "indicators", "stay-awake")),
    };
  }

  private config(): ShellConfig {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as ShellConfig;
    } catch {
      return {};
    }
  }

  private widgets(config: ShellConfig): Widget[] {
    return Object.values(config.bar?.layout ?? {}).flat();
  }

  settings(): BarSettings {
    const config = this.config();
    const clock = this.widgets(config).find((w) => w.id === "omarchy.clock");
    return {
      position: config.bar?.position ?? "top",
      background: config.bar?.background ?? (config.bar?.transparent ? "none" : "opaque"),
      clock: typeof clock?.format === "string" ? clock.format : "dddd HH:mm",
      hidden: existsSync(this.hiddenFlag),
    };
  }

  /** setBarWidget: `key` on the first instance of widget `id`, as Omarchy's shell does. */
  set(id: string, key: string, valueJson: string): string {
    const config = this.config();
    const widget = this.widgets(config).find((w) => w.id === id);
    if (!widget) return `${id} is not on the bar`;
    widget[key] = JSON.parse(valueJson);
    writeFileSync(`${this.file}.tmp`, JSON.stringify(config, null, 2) + "\n");
    renameSync(`${this.file}.tmp`, this.file);
    return "ok";
  }

  /** Calls `changed` when shell.json is written (editors replace it, so the directory is watched). */
  watch(changed: () => void) {
    try {
      watch(dirname(this.file), (_, name) => {
        if (name === "shell.json") changed();
      });
    } catch (error) {
      console.error(`omarchy-pocketd: watching ${this.file}: ${error}`);
    }
  }
}
