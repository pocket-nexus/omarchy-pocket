// Omarchy's menu in the stage's card (L1 + A, the function row's logo, or
// `omarchy-shell shell summon omarchy.menu`). An Apps row with a pin at its
// end is among the deck's pins (deck/dock.tsx); Y pins and unpins the selected one (deck/pins.ts). It has the keys while it is
// up: typing filters the level's rows as Omarchy's walker menu does, and at
// the root also looks through every app, best match first, so a name and Enter
// open it. The arrows move, Enter (or Right) opens, Backspace takes a filter
// character back and then a level, Escape clears the filter and then closes
// the menu.
// Opening a level asks omarchy-pocketd for every `when`, `checked` and
// `disabled` command of its rows; a row with a `when` appears once its
// command exits 0. A row's action closes the menu, as Omarchy's menu exits
// once a row is chosen, and runs through omarchy-pocketd as the Omarchy
// user; a failure shows as a toast.
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { conditions, request, run } from "../bridge.ts";
import type { App } from "../../../daemon/protocol.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { C } from "../classes.ts";
import { MENU } from "../generated/menu.ts";
import { UCONSOLE } from "../screen.ts";
import { conditionsOf, pathTo, PROVIDERS, providerRows, ROOT_TITLE, row, shown, type MenuItem, type MenuLevel, type Truth } from "../menu.ts";
import { keyRepeating } from "../keys.ts";
import { serve } from "../system.ts";
import { applets } from "../applets/applet.ts";
import { openWindow } from "../windows.ts";
import { openPackage } from "../packages.ts";
import { CARD_H, CARD_W } from "./geometry.ts";
import { createList, List, type ListState } from "../deck/list.tsx";
import { PIN, pinIds } from "../deck/pins.ts";
import { glide, place } from "../motion.ts";
import type { TouchFrame } from "../touch.ts";
import { PANELS, showPanel, type PanelName } from "./panels.tsx";
import { openThemePicker } from "./picker.tsx";
import { toast } from "./toasts.tsx";
import { color } from "../theme.ts";

const H = CARD_H;
const HEADER_H = 26;
const ROW_H = 22;
const ROWS = Math.floor((H - HEADER_H - 4) / ROW_H);
const CHECK = "\u{f012c}";
const CHEVRON = "\u{f0142}";
const ERROR = "\u{f015a}";
const INFO = "\u{f02fc}";
const APP = "\u{f018d}";
const APPLET = "\u{f0b8a}";
const TERMINAL = "\u{f018d}";
const AGENT = "\u{f06a9}";

const levelFor = (title: string, items: MenuItem[]): MenuLevel => ({ title, items, selected: items[0]?.id ?? "", scroll: 0, filter: "" });

// Omarchy Pocket's own row in Setup, after Network: mihomo's panel (the
// proxy Clash Verge Rev's core runs), summoned as Omarchy summons its
// Quickshell panels
{
  const setup = MENU.find((item) => item.id === "setup");
  if (setup && !setup.children.some((item) => item.id === "setup.proxy")) {
    const at = setup.children.findIndex((item) => item.id === "setup.network");
    setup.children.splice(at + 1, 0, row("setup.proxy", "\u{f0582}", "Proxy", "omarchy-shell shell summon omarchy.proxy"));
  }
  if (setup && !setup.children.some((item) => item.id === "setup.tailscale")) {
    const at = setup.children.findIndex((item) => item.id === "setup.proxy");
    setup.children.splice(at + 1, 0, row("setup.tailscale", "\u{f0318}", "Tailscale", "omarchy-shell shell summon omarchy.tailscale"));
  }
  // the uConsole gives its panel back to Raspberry Pi OS's desktop
  // (uconsole/rootfs: omarchy-pocket-session in Omarchy's root)
  const system = MENU.find((item) => item.id === "system");
  if (UCONSOLE && system && !system.children.some((item) => item.id === "system.desktop")) {
    const at = system.children.findIndex((item) => item.id === "system.lock");
    system.children.splice(at + 1, 0, row("system.desktop", "\u{f043f}", "Raspberry Pi Desktop", "omarchy-pocket-session off"));
  }
}

const [stack, setStack] = createSignal<MenuLevel[]>([levelFor(ROOT_TITLE, MENU)]);
const [menuOpen, setMenuOpen] = createSignal(false);
export { menuOpen };

/** Shows the menu at its root, or closes it. */
export function toggleMenu() {
  if (!menuOpen()) {
    setStack((s) => s.slice(0, 1));
    refreshApps();
  }
  setMenuOpen(!menuOpen());
}

export function closeMenu() {
  if (!menuOpen()) return;
  setMenuOpen(false);
  setStack((s) => s.slice(0, 1));
}
const [truth, setTruth] = createSignal<Truth>({});
const level = () => stack()[stack().length - 1]!;
/** Every app, as Apps lists it, for the root's search and the deck's pins. */
const [allApps, setAllApps] = createSignal<MenuItem[]>([]);
export { allApps };

/** How well `label` answers `needle`: the label itself, its start, a word's
 *  start, anywhere in it; null for no match. */
function matchRank(label: string, needle: string): number | null {
  const text = label.toLowerCase();
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  const at = text.indexOf(needle);
  if (at < 0) return null;
  return /[\s._-]/.test(text[at - 1] ?? "") ? 2 : 3;
}

/** The level's rows: those their `when` admits, then those the filter keeps.
 *  The root's filter takes in every app as well: a better match goes first,
 *  and at the same rank an app goes before a row of the menu. */
const rows = (l: MenuLevel) => {
  const admitted = shown(l.items, truth());
  if (!l.filter) return admitted;
  const needle = l.filter.toLowerCase();
  const apps = l.title === ROOT_TITLE ? allApps() : [];
  const ranked = [...apps, ...admitted].flatMap((item, order) => {
    const rank = matchRank(item.label, needle);
    return rank === null ? [] : [{ item, rank, order }];
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.item);
};
const indexIn = (l: MenuLevel) => Math.max(0, rows(l).findIndex((item) => item.id === l.selected));

function evaluate(items: MenuItem[]) {
  const commands = conditionsOf(items);
  if (!commands.length) return;
  conditions(commands).then(
    (results) => setTruth((t) => ({ ...t, ...Object.fromEntries(commands.map((c, i) => [c, results[i]!])) })),
    () => {},
  );
}

const update = (change: (l: MenuLevel) => MenuLevel) => setStack((s) => [...s.slice(0, -1), change(s[s.length - 1]!)]);

/** The shown level's list (a new one each time a level mounts). */
let list: ListState | null = null;
/** which way the next level slides in: +1 from the right (deeper), -1 from the left */
let entering = 1;

function select(index: number) {
  const l = level();
  const shownRows = rows(l);
  const item = shownRows[index];
  if (!item) return;
  update((v) => ({ ...v, selected: item.id }));
  list?.reveal(index, shownRows.length);
}

/** Up from the first row goes to the last (Apps to System), Down from the
 *  last to the first; a held arrow's repeats stop at the end. */
function move(delta: number) {
  const n = rows(level()).length;
  if (!n) return;
  const next = indexIn(level()) + delta;
  select(keyRepeating() ? Math.max(0, Math.min(n - 1, next)) : (next + n) % n);
}

function push(item: MenuItem) {
  remember();
  entering = 1;
  setStack((s) => [...s, levelFor(item.title, item.children)]);
  evaluate(item.children);
}

function back() {
  if (stack().length <= 1) return;
  entering = -1;
  setStack((s) => s.slice(0, -1));
}

/** The level keeps where its list was, for when it shows again. */
function remember() {
  const first = list?.first() ?? 0;
  update((v) => ({ ...v, scroll: first }));
}

/** The filter typed at this level; the first row it keeps is selected. */
function setFilter(filter: string) {
  update((v) => ({ ...v, filter }));
  list?.reset();
  const first = rows(level())[0];
  if (first) update((v) => ({ ...v, selected: first.id }));
}

/** The menu, open at Apps. */
export function showApps() {
  refreshApps();
  openAppsList();
  setMenuOpen(true);
}

/** The row the menu has selected. */
export const selectedItem = (): MenuItem | undefined => {
  const l = level();
  return rows(l)[indexIn(l)];
};

/** Opens an Apps row as the menu does (the deck's pins). */
export const openItem = (item: MenuItem) => activate(item);

/** The root level with Apps open. */
export function openAppsList() {
  entering = 1;
  setStack([levelFor(ROOT_TITLE, MENU)]);
  const apps = MENU.find((item) => item.id === "apps");
  if (apps) openProvider(apps);
}

/** Whether the menu shows its root level. */
export const atRoot = () => stack().length === 1;

/** Back to the root level. */
export function toRoot() {
  setStack((s) => s.slice(0, 1));
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

/** Packages by name: their marks in the Nerd Font, else the applet glyph. */
const MARKS: Record<string, string> = {
  youtube: "\u{f05c3}",
  github: "\u{f02a4}",
  discord: "\u{f066f}",
  x: "\u{f0544}",
  "hacker news": "\u{f1d4}",
  hn: "\u{f1d4}",
  weather: "\u{f0595}",
  maps: "\u{f034d}",
  podcasts: "\u{f0994}",
  spotify: "\u{f04c7}",
  "home assistant": "\u{f07d0}",
  home: "\u{f07d0}",
};
const iconOf = (app: App) => (app.applet ? (MARKS[app.name.toLowerCase()] ?? APPLET) : APP);

/** The shell's own windows first (Terminal, Agent, the applets), then packages and terminal programs. */
const appRows = (): Promise<MenuItem[]> => {
  const windows: MenuItem[] = [
    { ...row("apps.terminal", TERMINAL, "Terminal", ""), open: "terminal" },
    { ...row("apps.agent", AGENT, "Agent", ""), open: "agent" },
    ...applets().map((a) => ({ ...row(`apps.${a.id}`, a.icon, a.title, ""), open: a.id })),
  ];
  return request<App[]>({ method: "apps" }).then(
    (apps) => [...windows, ...apps.map((a) => ({ ...row(`apps.${a.id}`, iconOf(a), a.name, a.command), applet: a.applet, aux: a.aux, appletSurface: a.appletSurface }))],
    () => windows,
  );
};

/** The search's apps, read again each time the menu opens or the deck's pins show: one may have been installed. */
export function refreshApps() {
  void appRows().then(setAllApps);
}

/** A provider's rows as a new level: Omarchy's bash providers, or the
 *  daemon's terminal applications for Apps. */
function openProvider(item: MenuItem) {
  const fill = (rows: MenuItem[]) => {
    if (!rows.length) return toast({ icon: INFO, title: item.label, body: "Nothing to list", tone: "info" });
    remember();
    entering = 1;
    setStack((s) => [...s, levelFor(item.title, rows)]);
  };
  const failed = (error: unknown) => toast({ icon: ERROR, title: item.label, body: String(error), tone: "error" });
  if (item.provider === "apps") {
    void appRows().then(fill);
  } else if (PROVIDERS[item.provider]) {
    run(PROVIDERS[item.provider]!.script).then((result) => fill(providerRows(item.id, item.provider, result.stdout)), failed);
  } else toast({ icon: INFO, title: item.label, body: `The ${item.provider} list is not in Omarchy Pocket`, tone: "info" });
}

function activate(item: MenuItem) {
  if (item.children.length) return push(item);
  if (item.disabled && truth()[item.disabled]) return;
  if (item.provider) return openProvider(item);
  if (item.open) {
    // the window takes the stage; the menu is at its root when it comes back
    if (openWindow(item.open)) closeMenu();
    return;
  }
  if (item.applet) {
    // a package opens in a window beside the focused one, as any window does
    closeMenu();
    openPackage(item.applet, item.label, item.aux === true, item.appletSurface === true);
    return;
  }
  if (item.action) {
    // as Omarchy's menu exits once a row runs, so the card goes
    closeMenu();
    run(item.action).then(
      (result) => {
        if (result.code !== 0) {
          toast({ icon: ERROR, title: `${item.label} failed (${result.code ?? "signal"})`, body: lastLine(result.stderr) || lastLine(result.stdout), tone: "error" });
        }
      },
      (error) => toast({ icon: ERROR, title: item.label, body: String(error), tone: "error" }),
    );
  }
}

/** Opens the menu at `id` ("root" is the top). */
export function summon(id: string) {
  const path = id === "root" ? [] : pathTo(MENU, id);
  if (!path) return false;
  const levels = [levelFor(ROOT_TITLE, MENU)];
  for (const item of path) {
    levels[levels.length - 1]!.selected = item.id;
    if (item.children.length) levels.push(levelFor(item.title, item.children));
  }
  setStack(levels);
  for (const l of levels) evaluate(l.items);
  return true;
}

// `omarchy-shell shell summon|toggle omarchy.menu '{"menu":"system"}'` and Omarchy's
// menu aliases land here; other plugins are not in Omarchy Pocket yet.
function summonPlugin(id: string, payloadJson: string) {
  if (id === "omarchy.menu") {
    let menu = "root";
    try {
      menu = JSON.parse(payloadJson || "{}").menu || "root";
    } catch {}
    summon(menu);
    refreshApps();
    setMenuOpen(true);
    return "ok";
  }
  const panelName = id.replace(/^omarchy\./, "") as PanelName;
  if (PANELS.includes(panelName)) {
    showPanel(panelName);
    return "ok";
  }
  if (id === "omarchy.image-picker") {
    let source = "";
    try {
      source = JSON.parse(payloadJson || "{}").source || "";
    } catch {}
    if (source === "themes") {
      openThemePicker();
      return "ok";
    }
  }
  toast({ icon: INFO, title: id, body: "This Omarchy panel is not in Omarchy Pocket yet", tone: "info" });
  return "missing";
}
serve("shell", { summon: summonPlugin, toggle: summonPlugin });

evaluate(MENU);
refreshApps();

/** A key at the menu. */
export function menuKey(name: string) {
  const l = level();
  switch (name) {
    case "Up":
      return move(-1);
    case "Down":
      return move(1);
    case "Enter":
    case "Right": {
      const item = rows(l)[indexIn(l)];
      if (item) activate(item);
      return;
    }
    case "Left":
      return back();
    case "Backspace":
      if (l.filter) return setFilter(l.filter.slice(0, -1));
      return atRoot() ? closeMenu() : back();
    case "Escape":
      if (l.filter) return setFilter("");
      return closeMenu();
  }
}

/** A character typed at the menu narrows the level to the rows that contain it. */
export function menuText(ch: string) {
  if (ch === " " && !level().filter) return;
  setFilter(level().filter + ch);
}

/** Fingers on the menu (card coordinates; the touchpad's clicks): a tap on
 *  the header goes back, a tap selects a row and a tap on the selected row
 *  opens it, a drag scrolls. */
export function menuTouch(frame: TouchFrame) {
  for (const tap of frame.taps) if (!tap.moved && tap.y < HEADER_H) return atRoot() ? closeMenu() : back();
  const shownRows = rows(level());
  list?.touch(frame, shownRows.length, (index) => {
    const item = shownRows[index];
    if (!item) return;
    if (item.id === level().selected) activate(item);
    else select(index);
  });
}

function Row(props: { item: () => MenuItem; selected: () => boolean }) {
  const disabled = () => !!props.item().disabled && truth()[props.item().disabled] === true;
  const checked = () => props.item().current === true || (!!props.item().checked && truth()[props.item().checked] === true);
  const pinned = () => props.item().id.startsWith("apps.") && pinIds(allApps()).includes(props.item().id);
  return (
    <>
      <Text class={C.icon} style={{ textColor: color(props.selected() ? "accent" : "dark_foreground") }}>{props.item().icon}</Text>
      <Text
        class={C.label}
        style={{ textColor: color(disabled() ? "dark_foreground" : props.selected() ? "bright_foreground" : "foreground"), ...cjk(props.item().label, CJK_SLOT_14) }}
      >
        {props.item().label}
      </Text>
      <Show when={props.item().children.length > 0 || checked() || pinned()}>
        <Text class={C.chevron} style={{ textColor: color(checked() ? "accent" : "dark_foreground") }}>
          {props.item().children.length > 0 ? CHEVRON : checked() ? CHECK : PIN}
        </Text>
      </Show>
    </>
  );
}

/** One level: its own list, sliding in from the side it was reached from. */
function Level() {
  const l = level();
  const state = createList(ROW_H, HEADER_H, ROWS, Math.max(0, Math.min(l.scroll, rows(l).length - ROWS)));
  list = state;
  let node: NodeMirror | undefined;
  onMount(() => {
    place(node, "translateX", entering * 48);
    place(node, "opacity", 0);
    glide(node, "translateX", 0, 160);
    glide(node, "opacity", 1, 160);
  });
  return (
    <View class={C.card} ref={(n: NodeMirror) => (node = n)}>
      <List state={state} items={() => rows(level())} top={HEADER_H} rowH={ROW_H} width={CARD_W - 16} selected={() => indexIn(level())}>
        {(item) => <Row item={item} selected={() => level().selected === item().id} />}
      </List>
      <Show when={level().filter && rows(level()).length === 0}>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: HEADER_H + 40, width: CARD_W, textColor: color("dark_foreground") }}>
          {`nothing here matches "${level().filter}"`}
        </Text>
      </Show>
    </View>
  );
}

/** The menu's path, for the strip. */
export const menuTitle = () => stack().map((l) => l.title).join(" › ");

export function MenuCard() {
  const crumbs = () => stack().map((l) => l.title).join(`  ${CHEVRON}  `);
  // a level remounts when the stack changes depth or contents, not on a move
  const levelItems = createMemo(() => level().items);
  return (
    <View class={C.card} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{crumbs()}</Text>
      <Show when={level().filter}>
        <Text class="absolute right-[12] top-[6] font-mono text-sm leading-[16]" style={{ textColor: color("bright_foreground") }}>{`${level().filter}_`}</Text>
      </Show>
      <View class={C.cardRule} style={{ bgColor: color("muted") }} />
      <Show when={levelItems()} keyed>
        {(_items) => <Level />}
      </Show>
    </View>
  );
}
