// Omarchy Pocket's shell: Omarchy's desktop elements on the RG DS Plus's two
// 512x384-point panels. The top panel is the stage: the theme's wallpaper
// under Omarchy's bar (menu, workspaces, clock, indicators, in the order of
// Omarchy's default shell.json layout). The bottom panel is the deck: the
// Omarchy menu, read from Omarchy's own omarchy-menu.jsonc, driven by the
// gamepad and by touch.
import { createMemo, createSignal, For, Show } from "solid-js";
import { AuxiliarySurface, Image, Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { auxiliaryTouches, BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { MENU } from "./generated/menu.ts";
import { C } from "./generated/classes.ts";
import { ROOT_TITLE, scrollFor, shown, type MenuItem, type MenuLevel } from "./menu.ts";

const W = 512;
const H = 384;
const BAR_H = 18;
const HEADER_H = 26;
const FOOTER_H = 20;
const ROW_H = 22;
const ROWS = Math.floor((H - HEADER_H - FOOTER_H) / ROW_H);
// The program maps the RG DS Plus's A to CIRCLE and B to CROSS.
const OPEN = BTN.CIRCLE;
const BACK = BTN.CROSS;
const REPEATS = BTN.UP | BTN.DOWN;
const REPEAT_AFTER = 18;
const REPEAT_EVERY = 4;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WORKSPACES = [1, 2, 3, 4, 5];
// omarchy.bluetooth, omarchy.network, omarchy.audio, omarchy.power
const INDICATORS = "\u{f00af}  \u{f05a9}  \u{f057e}  \u{f0079}";

const two = (n: number) => (n < 10 ? `0${n}` : String(n));
const clockText = (now: Date) => `${WEEKDAYS[now.getDay()]} ${two(now.getHours())}:${two(now.getMinutes())}`;

function Bar(props: { clock: () => string; workspace: () => number }) {
  return (
    <View class={C.bar}>
      <Text class={C.barText} style={{ insetL: 6 }}>{"\u{e900}"}</Text>
      <For each={WORKSPACES}>
        {(n) => (
          <Text class={props.workspace() === n ? C.workspaceOn : C.workspace} style={{ insetL: 14 + n * 12 }}>
            {String(n)}
          </Text>
        )}
      </For>
      <Text class={C.barCenter}>{props.clock()}</Text>
      <Text class={C.barRight}>{INDICATORS}</Text>
    </View>
  );
}

function Row(props: { item: MenuItem; selected: () => boolean; top: number }) {
  return (
    <View class="absolute left-[8] w-[496] h-[22]" style={{ insetT: props.top }}>
      <Show when={props.selected()}>
        <View class={C.rowOn} />
      </Show>
      <Text class={props.selected() ? C.iconOn : C.icon}>{props.item.icon}</Text>
      <Text class={props.selected() ? C.labelOn : C.label}>{props.item.label}</Text>
      <Show when={shown(props.item.children).length > 0}>
        <Text class={C.chevron}>{"\u{f0142}"}</Text>
      </Show>
    </View>
  );
}

export default function Shell() {
  const [now, setNow] = createSignal(new Date());
  const tick = () => {
    setNow(new Date());
    after(1, tick);
  };
  after(1, tick);

  const [stack, setStack] = createSignal<MenuLevel[]>([{ title: ROOT_TITLE, items: shown(MENU), index: 0, scroll: 0 }]);
  const level = () => stack()[stack().length - 1]!;
  const [notice, setNotice] = createSignal<{ title: string; detail: string } | null>(null);
  const [workspace, setWorkspace] = createSignal(1);

  const update = (change: (l: MenuLevel) => MenuLevel) =>
    setStack((s) => [...s.slice(0, -1), change(s[s.length - 1]!)]);
  const move = (delta: number) =>
    update((l) => {
      const index = Math.max(0, Math.min(l.items.length - 1, l.index + delta));
      return { ...l, index, scroll: scrollFor(l, index, ROWS) };
    });
  const open = (item: MenuItem) => {
    if (shown(item.children).length) {
      setStack((s) => [...s, { title: item.title, items: shown(item.children), index: 0, scroll: 0 }]);
    } else if (item.action || item.provider) {
      setNotice({
        title: item.label,
        detail: item.action ? item.action : `provider: ${item.provider}`,
      });
    }
  };
  const back = () => {
    if (notice()) setNotice(null);
    else if (stack().length > 1) setStack((s) => s.slice(0, -1));
  };
  const press = (key: number) => {
    if (key & BTN.UP) move(-1);
    else if (key & BTN.DOWN) move(1);
    else if (key & BTN.LTRIGGER) move(-ROWS);
    else if (key & BTN.RTRIGGER) move(ROWS);
    else if (key & (OPEN | BTN.RIGHT)) open(level().items[level().index]!);
    else if (key & (BACK | BTN.LEFT)) back();
    else if (key & BTN.START) setStack((s) => s.slice(0, 1));
    else if (key & BTN.ZL) setWorkspace((w) => (w > 1 ? w - 1 : 5));
    else if (key & BTN.ZR) setWorkspace((w) => (w < 5 ? w + 1 : 1));
  };

  let held = 0;
  let heldFor = 0;
  let touch: { x: number; y: number } | null = null;
  const KEYS = [BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, OPEN, BACK, BTN.START, BTN.LTRIGGER, BTN.RTRIGGER, BTN.ZL, BTN.ZR];
  onFrame((buttons: number) => {
    const down = buttons & ~held;
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    for (const key of KEYS) {
      if (down & key) press(key);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) press(key);
    }
    // A tap on the deck selects the row under it; a tap on the selected row opens it.
    const contact = auxiliaryTouches()[0];
    if (contact) touch = { x: contact.x, y: contact.y };
    else if (touch) {
      const { y } = touch;
      touch = null;
      if (y < HEADER_H) back();
      else if (y < H - FOOTER_H) {
        const l = level();
        const index = l.scroll + Math.floor((y - HEADER_H) / ROW_H);
        if (index < l.items.length) {
          if (index === l.index) open(l.items[index]!);
          else update((v) => ({ ...v, index }));
        }
      }
    }
  });

  const visible = createMemo(() => {
    const l = level();
    return l.items.slice(l.scroll, l.scroll + ROWS).map((item, i) => ({ item, index: l.scroll + i }));
  });
  const crumbs = () => stack().map((l) => l.title).join("  \u{f0142}  ");

  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]">
      <Image class="absolute left-0 top-0 w-[256] h-[256]" src="wall-0-0.png" />
      <Image class="absolute left-[256] top-0 w-[256] h-[256]" src="wall-1-0.png" />
      <Image class="absolute left-0 top-[256] w-[256] h-[128]" src="wall-0-1.png" />
      <Image class="absolute left-[256] top-[256] w-[256] h-[128]" src="wall-1-1.png" />
      <Bar clock={() => clockText(now())} workspace={workspace} />
      <Show when={notice()}>
        {(n) => (
          <View class={C.notice}>
            <Text class={C.noticeTitle}>{n().title}</Text>
            <Text class={C.noticeBody}>{n().detail}</Text>
            <Text class={C.noticeNote}>Runs through the Omarchy bridge (M2)</Text>
          </View>
        )}
      </Show>
      <AuxiliaryDeck crumbs={crumbs} visible={visible} level={level} />
    </View>
  );

  function AuxiliaryDeck(props: {
    crumbs: () => string;
    visible: () => { item: MenuItem; index: number }[];
    level: () => MenuLevel;
  }) {
    return (
      <AuxiliarySurface>
        <View class={C.deck}>
          <Text class={C.crumbs}>{props.crumbs()}</Text>
          <View class={C.rule} />
          <For each={props.visible()}>
            {(row) => (
              <Row
                item={row.item}
                selected={() => props.level().index === row.index}
                top={HEADER_H + (row.index - props.level().scroll) * ROW_H}
              />
            )}
          </For>
          <View class={C.footer}>
            <Text class={C.hint}>{"A open   B back   L1/R1 page   L2/R2 workspace   Start menu"}</Text>
          </View>
        </View>
      </AuxiliarySurface>
    );
  }
}

