// Notes: Markdown files in ~/Documents/Notes. The deck lists them (a finger
// drags the list) and the window shows the highlighted one; a tap on the
// highlighted row opens it for editing on the touch keyboard (with pinyin,
// term/ime.ts), the text in the window with a cursor, wrapped to its width.
// The strip's close button or X closes the note; the D-pad moves the cursor.
// Edits are written a second after the last key and on close.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { C } from "../classes.ts";
import { cjk } from "../glyphs.ts";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";
import { composing } from "../term/ime.ts";
import { Keyboard, keyboardTouch, sendKey, type KeySink } from "../term/keyboard.tsx";
import { BODY_H } from "../deck/geometry.ts";
import { createScroll } from "../deck/scroll.ts";
import type { TouchFrame } from "../touch.ts";
import { register } from "./applet.ts";

const [names, setNames] = createSignal<string[]>([]);
const [selected, setSelected] = createSignal(0);
const [preview, setPreview] = createSignal("");
const [editing, setEditing] = createSignal<string | null>(null);
const [chars, setChars] = createSignal<string[]>([]);
const [cursor, setCursor] = createSignal(0);
let edits = 0;
let saved = 0;

const NEW = "New note";
const rowsOf = () => [NEW, ...names().map((n) => n.replace(/\.md$/, ""))];

const fail = (error: unknown) => toast({ icon: "\u{f015a}", title: "Notes", body: String(error).replace(/^Error: /, ""), tone: "error" });

function reload() {
  request<string[]>({ method: "notes" }).then((list) => {
    setNames(list);
    setSelected((s) => Math.min(s, list.length));
    loadPreview();
  }, fail);
}

let previewing = 0;
function loadPreview() {
  const mine = ++previewing;
  const name = names()[selected() - 1];
  if (!name) return setPreview("");
  after(0.2, () => {
    if (mine === previewing) request<string>({ method: "noteRead", name }).then((text) => mine === previewing && setPreview(text), () => {});
  });
}

function open(index: number) {
  const name = index === 0 ? newName() : names()[index - 1];
  if (!name) return;
  const start = (text: string) => {
    setEditing(name);
    setChars([...text]);
    setCursor(text.length ? [...text].length : 0);
    edits = saved = 0;
  };
  if (index === 0) start("");
  else request<string>({ method: "noteRead", name }).then(start, fail);
}

function newName() {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.md`;
}

function save() {
  const name = editing();
  if (!name || saved === edits) return;
  const at = edits;
  request({ method: "noteWrite", name, text: chars().join("") }).then(() => (saved = Math.max(saved, at)), fail);
}

function changed() {
  const at = ++edits;
  after(1, () => at === edits && save());
}

function closeNote() {
  save();
  setEditing(null);
  reload();
}

/** Logical line bounds around `at`: [start, end) without the newline. */
function lineAt(list: string[], at: number) {
  let start = at;
  while (start > 0 && list[start - 1] !== "\n") start--;
  let end = at;
  while (end < list.length && list[end] !== "\n") end++;
  return { start, end };
}

function insert(text: string) {
  const at = cursor();
  const add = [...text];
  setChars((list) => [...list.slice(0, at), ...add, ...list.slice(at)]);
  setCursor(at + add.length);
  changed();
}

function key(name: string) {
  const list = chars();
  const at = cursor();
  switch (name) {
    case "Enter":
      return insert("\n");
    case "Tab":
      return insert("  ");
    case "Backspace":
      if (!at) return;
      setChars([...list.slice(0, at - 1), ...list.slice(at)]);
      setCursor(at - 1);
      return changed();
    case "Delete":
      if (at >= list.length) return;
      setChars([...list.slice(0, at), ...list.slice(at + 1)]);
      return changed();
    case "Left":
      return setCursor(Math.max(0, at - 1));
    case "Right":
      return setCursor(Math.min(list.length, at + 1));
    case "Home":
      return setCursor(lineAt(list, at).start);
    case "End":
      return setCursor(lineAt(list, at).end);
    case "Up":
    case "Down": {
      const line = lineAt(list, at);
      const column = at - line.start;
      if (name === "Up") {
        if (!line.start) return setCursor(0);
        const above = lineAt(list, line.start - 1);
        return setCursor(Math.min(above.end, above.start + column));
      }
      if (line.end >= list.length) return setCursor(list.length);
      const below = lineAt(list, line.end + 1);
      return setCursor(Math.min(below.end, below.start + column));
    }
    case "Escape":
      return closeNote();
  }
}

const sink: KeySink = {
  text: insert,
  key: (name) => key(name),
  close: closeNote,
  hint: () => "A newline  B Bksp  D-pad cursor  X or \u{f0156} done",
};

// The window: wrapped lines in the 14 px mono face; a CJK character advances 14 points.
const LINE_H = 18;
const TOP = 26;
const wide = (ch: string) => ch.codePointAt(0)! >= 0x1100;
const advance = (ch: string) => (wide(ch) ? 14 : 8.4);

interface Line {
  start: number;
  text: string;
  /** x of each character's left edge, and of the line's end */
  xs: number[];
}

function wrap(list: string[], width: number): Line[] {
  const lines: Line[] = [];
  let line: Line = { start: 0, text: "", xs: [0] };
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (ch === "\n") {
      lines.push(line);
      line = { start: i + 1, text: "", xs: [0] };
      continue;
    }
    const x = line.xs[line.xs.length - 1]!;
    if (x + advance(ch) > width && line.text) {
      lines.push(line);
      line = { start: i, text: "", xs: [0] };
    }
    line.text += ch;
    line.xs.push(line.xs[line.xs.length - 1]! + advance(ch));
  }
  lines.push(line);
  return lines;
}

function Page(props: { chars: () => string[]; cursor?: () => number; title: string; w: number; h: number }) {
  const lines = createMemo(() => wrap(props.chars(), props.w - 24));
  const count = () => Math.max(1, Math.floor((props.h - TOP - 6) / LINE_H));
  const caret = () => {
    const at = props.cursor?.();
    if (at === undefined) return null;
    const list = lines();
    let row = list.length - 1;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.start > at) {
        row = i - 1;
        break;
      }
    }
    const line = list[Math.max(0, row)]!;
    return { row: Math.max(0, row), x: line.xs[Math.min(line.xs.length - 1, at - line.start)] ?? 0 };
  };
  const first = () => {
    const c = caret();
    return c ? Math.max(0, c.row - count() + 1) : 0;
  };
  return (
    <>
      <Text class="absolute left-[12] top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ width: props.w - 24, textColor: color("dark_foreground"), ...cjk(props.title, CJK_SLOT_14) }}>{props.title}</Text>
      <For each={lines().slice(first(), first() + count())}>
        {(line, i) => (
          <Text class="absolute left-[12] h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ insetT: TOP + i() * LINE_H, width: props.w - 20, textColor: color("foreground"), ...cjk(line.text, CJK_SLOT_14) }}>
            {line.text}
          </Text>
        )}
      </For>
      <Show when={caret()}>
        {(c) => <View class="absolute w-[2] h-[16]" style={{ insetL: 12 + c().x, insetT: TOP + 1 + (c().row - first()) * LINE_H, bgColor: color("accent") }} />}
      </Show>
    </>
  );
}

function Stage(props: { w: number; h: number }) {
  return (
    <Show when={editing()} fallback={<Page chars={() => [...preview()]} title={names()[selected() - 1]?.replace(/\.md$/, "") ?? "Tap New note on the deck"} w={props.w} h={props.h} />}>
      <Page chars={chars} cursor={cursor} title={`${(editing() ?? "").replace(/\.md$/, "")}  (editing)`} w={props.w} h={props.h} />
    </Show>
  );
}

const ROW_H = 22;
const LIST_TOP = 30;
const scroller = createScroll(ROW_H, LIST_TOP, Math.floor((BODY_H - LIST_TOP - 4) / ROW_H));

function List() {
  const visible = () => rowsOf().slice(scroller.first(), scroller.first() + scroller.rows).map((label, i) => ({ label, at: scroller.first() + i }));
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>Notes</Text>
      <Text class="absolute right-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>tap twice to open</Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <For each={visible()}>
        {(item, i) => (
          <View class={C.row} style={{ insetT: LIST_TOP + i() * ROW_H }}>
            <Show when={item.at === selected()}>
              <View class={C.rowOn} style={{ bgColor: color("selection") }} />
            </Show>
            <Text class={C.icon} style={{ textColor: color(item.at === selected() ? "accent" : "dark_foreground") }}>{item.at === 0 ? "\u{f0415}" : "\u{f09ed}"}</Text>
            <Text class={C.label} style={{ textColor: color(item.at === selected() ? "bright_foreground" : "foreground"), ...cjk(item.label, CJK_SLOT_14) }}>{item.label}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

function Deck() {
  return (
    <Show when={editing()} fallback={<List />}>
      <Keyboard mode="body" />
    </Show>
  );
}

function select(index: number) {
  const next = Math.max(0, Math.min(rowsOf().length - 1, index));
  if (next === selected()) return;
  setSelected(next);
  scroller.reveal(next, rowsOf().length);
  loadPreview();
}

const EDIT_KEYS: [number, string][] = [
  [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
  [BTN.CIRCLE, "Enter"], [BTN.CROSS, "Backspace"],
];

register({
  id: "notes",
  title: "Notes",
  icon: "\u{f09ed}",
  Stage,
  Deck,
  keys: () => (editing() ? sink : null),
  press(button) {
    if (editing()) {
      if (button & BTN.TRIANGLE) return closeNote();
      if (button & BTN.CIRCLE && composing()) return sendKey(" ");
      for (const [mask, name] of EDIT_KEYS) if (button & mask) return sendKey(name);
      return;
    }
    if (button & BTN.UP) select(selected() - 1);
    else if (button & BTN.DOWN) select(selected() + 1);
    else if (button & BTN.CIRCLE) open(selected());
  },
  touches(frame: TouchFrame) {
    if (editing()) return keyboardTouch(frame, "body");
    scroller.touch(frame, rowsOf().length, (at) => (at === selected() || at === 0 ? open(at) : select(at)));
  },
  shown: reload,
  hidden: save,
});
