// The Omarchy menu on the deck, the Go tab of the Omarchy deck
// (omarchy-deck.tsx). Opening a level asks
// omarchy-pocketd for every `when`, `checked` and `disabled` command of its
// rows; a row with a `when` appears once its command exits 0. A row's action
// runs through omarchy-pocketd as the Omarchy user; a failure shows as a
// toast, and the level's conditions are read again afterwards (toggles).
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { conditions, request, run } from "../bridge.ts";
import type { App } from "../../../daemon/protocol.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { C } from "../classes.ts";
import { MENU } from "../generated/menu.ts";
import { conditionsOf, pathTo, PROVIDERS, providerRows, ROOT_TITLE, row, scrollFor, shown, type MenuItem, type MenuLevel, type Truth } from "../menu.ts";
import { serve } from "../system.ts";
import { applets } from "../applets/applet.ts";
import { openWindow } from "../windows.ts";
import { setDeckOpen } from "./deck-state.ts";
import { BODY_H } from "./geometry.ts";
import { PANELS, showPanel, type PanelName } from "./panels.tsx";
import { openThemePicker } from "./picker.tsx";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";

const H = BODY_H;
const HEADER_H = 26;
const FOOTER_H = 20;
const ROW_H = 22;
const ROWS = Math.floor((H - HEADER_H - FOOTER_H) / ROW_H);
// The device program maps the RG DS Plus's A to CIRCLE and B to CROSS.
export const OPEN = BTN.CIRCLE;
export const BACK = BTN.CROSS;
const CHECK = "\u{f012c}";
const CHEVRON = "\u{f0142}";
const ERROR = "\u{f015a}";
const INFO = "\u{f02fc}";
const APP = "\u{f018d}";
const APPLET = "\u{f0b8a}";
const TERMINAL = "\u{f018d}";

const levelFor = (title: string, items: MenuItem[]): MenuLevel => ({ title, items, selected: items[0]?.id ?? "", scroll: 0 });

const [stack, setStack] = createSignal<MenuLevel[]>([levelFor(ROOT_TITLE, MENU)]);
const [truth, setTruth] = createSignal<Truth>({});
const level = () => stack()[stack().length - 1]!;
const rows = (l: MenuLevel) => shown(l.items, truth());
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

function move(delta: number) {
  update((l) => {
    const list = rows(l);
    if (!list.length) return l;
    const index = Math.max(0, Math.min(list.length - 1, indexIn(l) + delta));
    return { ...l, selected: list[index]!.id, scroll: scrollFor(scrollOf(l, list), index, ROWS) };
  });
}

function push(item: MenuItem) {
  setStack((s) => [...s, levelFor(item.title, item.children)]);
  evaluate(item.children);
}

function back() {
  if (stack().length > 1) setStack((s) => s.slice(0, -1));
}

/** Select: the root level with Apps open. */
export function openAppsList() {
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

/** A provider's rows as a new level: Omarchy's bash providers, or the
 *  daemon's terminal applications for Apps. */
function openProvider(item: MenuItem) {
  const fill = (rows: MenuItem[]) => {
    if (!rows.length) return toast({ icon: INFO, title: item.label, body: "Nothing to list", tone: "info" });
    setStack((s) => [...s, levelFor(item.title, rows)]);
  };
  const failed = (error: unknown) => toast({ icon: ERROR, title: item.label, body: String(error), tone: "error" });
  if (item.provider === "apps") {
    // the shell's own windows first, then packages and terminal programs
    const windows: MenuItem[] = [
      { ...row("apps.terminal", TERMINAL, "Terminal", ""), open: "terminal" },
      ...applets().map((a) => ({ ...row(`apps.${a.id}`, a.icon, a.title, ""), open: a.id })),
    ];
    request<App[]>({ method: "apps" }).then(
      (apps) => fill([...windows, ...apps.map((a) => ({ ...row(`apps.${a.id}`, a.applet ? APPLET : APP, a.name, a.command), applet: a.applet }))]),
      () => fill(windows),
    );
  } else if (PROVIDERS[item.provider]) {
    run(PROVIDERS[item.provider]!.script).then((result) => fill(providerRows(item.id, item.provider, result.stdout)), failed);
  } else toast({ icon: INFO, title: item.label, body: `The ${item.provider} list is not in Omarchy Pocket`, tone: "info" });
}

function activate(item: MenuItem) {
  if (item.children.length) return push(item);
  if (item.disabled && truth()[item.disabled]) return;
  if (item.provider) return openProvider(item);
  if (item.open) {
    // the window takes the deck; the menu is at its root when it comes back
    if (openWindow(item.open)) {
      setDeckOpen(false);
      toRoot();
    }
    return;
  }
  if (item.applet) {
    // the host runs the applet once this frame presents; Select + Start returns
    const bridge = (globalThis as { omarchyBridge?: { launch(path: string): boolean } }).omarchyBridge;
    if (!bridge?.launch(item.applet)) toast({ icon: ERROR, title: item.label, body: "This host cannot run applets", tone: "error" });
    return;
  }
  if (item.action) {
    const where = level();
    run(item.action).then(
      (result) => {
        if (result.code !== 0) {
          toast({ icon: ERROR, title: `${item.label} failed (${result.code ?? "signal"})`, body: lastLine(result.stderr) || lastLine(result.stdout), tone: "error" });
        }
        if (level() === where || stack().includes(where)) evaluate(where.items);
      },
      (error) => toast({ icon: ERROR, title: item.label, body: String(error), tone: "error" }),
    );
  }
}

/** Opens the deck at the menu with `id` ("root" is the top). */
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
    return "ok";
  }
  const panelName = id.replace(/^omarchy\./, "") as PanelName;
  if (PANELS.includes(panelName)) {
    setDeckOpen(true);
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

export function deckPress(key: number) {
  if (key & BTN.UP) move(-1);
  else if (key & BTN.DOWN) move(1);

  else if (key & (OPEN | BTN.RIGHT)) {
    const item = rows(level())[indexIn(level())];
    if (item) activate(item);
  } else if (key & (BACK | BTN.LEFT)) back();

}

/** A tap on the deck selects the row under it; a tap on the selected row opens it. */
export function deckTap(y: number) {
  if (y < HEADER_H) return back();
  if (y >= H - FOOTER_H) return;
  const l = level();
  const list = rows(l);
  const index = scrollOf(l, list) + Math.floor((y - HEADER_H) / ROW_H);
  const item = list[index];
  if (!item) return;
  if (item.id === l.selected) activate(item);
  else update((v) => ({ ...v, selected: item.id }));
}

/** The level's scroll, kept inside the rows that are shown now. */
function scrollOf(l: MenuLevel, list: MenuItem[]) {
  return Math.max(0, Math.min(l.scroll, list.length - ROWS));
}

function Row(props: { item: MenuItem; selected: () => boolean; top: number }) {
  const disabled = () => !!props.item.disabled && truth()[props.item.disabled] === true;
  const checked = () => props.item.current === true || (!!props.item.checked && truth()[props.item.checked] === true);
  return (
    <View class={C.row} style={{ insetT: props.top }}>
      <Show when={props.selected()}>
        <View class={C.rowOn} style={{ bgColor: color("selection") }} />
      </Show>
      <Text class={C.icon} style={{ textColor: color(props.selected() ? "accent" : "dark_foreground") }}>{props.item.icon}</Text>
      <Text
        class={C.label}
        style={{ textColor: color(disabled() ? "dark_foreground" : props.selected() ? "bright_foreground" : "foreground"), ...cjk(props.item.label, CJK_SLOT_14) }}
      >
        {props.item.label}
      </Text>
      <Show when={props.item.children.length > 0 || checked()}>
        <Text class={C.chevron} style={{ textColor: color(checked() ? "accent" : "dark_foreground") }}>
          {props.item.children.length > 0 ? CHEVRON : CHECK}
        </Text>
      </Show>
    </View>
  );
}

export function MenuDeck() {
  const visible = createMemo(() => {
    const l = level();
    const list = rows(l);
    const scroll = scrollOf(l, list);
    return list.slice(scroll, scroll + ROWS).map((item, i) => ({ item, top: HEADER_H + i * ROW_H }));
  });
  const crumbs = () => stack().map((l) => l.title).join(`  ${CHEVRON}  `);
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{crumbs()}</Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <For each={visible()}>{(row) => <Row item={row.item} selected={() => level().selected === row.item.id} top={row.top} />}</For>
    </View>
  );
}
