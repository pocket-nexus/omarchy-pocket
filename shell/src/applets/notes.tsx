// Notes: Markdown files in ~/Documents/Notes. The window lists them, newest
// first, with a preview of the highlighted one beside the list when the
// window is wide enough; Enter opens the highlighted note (or a new one) for
// editing on the keyboard (with pinyin, term/ime.ts), the text in the window
// with a cursor, wrapped to its width. The arrows move the cursor, Escape
// (or the close button above the keys) closes the note. Edits are written a
// second after the last key and on close.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import type { KeySink } from "../keys.ts";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";
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
  hint: () => "editing · Esc or \u{f0156} closes · A newline · B Bksp · Y space",
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

function Page(props: { chars: () => string[]; cursor?: () => number; title: string; x: number; w: number; h: number }) {
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
      <Text class="absolute top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ insetL: props.x + 12, width: props.w - 24, textColor: color("dark_foreground"), ...cjk(props.title, CJK_SLOT_14) }}>
        {props.title}
      </Text>
      <For each={lines().slice(first(), first() + count())}>
        {(line, i) => (
          <Text class="absolute h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ insetL: props.x + 12, insetT: TOP + i() * LINE_H, width: props.w - 20, textColor: color("foreground"), ...cjk(line.text, CJK_SLOT_14) }}>
            {line.text}
          </Text>
        )}
      </For>
      <Show when={caret()}>
        {(c) => <View class="absolute w-[2] h-[16]" style={{ insetL: props.x + 12 + c().x, insetT: TOP + 1 + (c().row - first()) * LINE_H, bgColor: color("accent") }} />}
      </Show>
    </>
  );
}

const ROW_H = 22;
const LIST_W = 180;

/** The notes as a column; the selected row is highlighted and kept in view. */
function Rows(props: { w: number; h: number }) {
  const count = () => Math.max(1, Math.floor((props.h - TOP - 4) / ROW_H));
  const first = () => Math.max(0, Math.min(selected() - count() + 1, rowsOf().length - count()));
  return (
    <>
      <Text class="absolute left-[12] top-[6] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>{`Notes  ${names().length}`}</Text>
      <For each={rowsOf().slice(first(), first() + count())}>
        {(label, i) => {
          const at = () => first() + i();
          return (
            <View class="absolute rounded-sm" style={{ insetL: 6, insetT: TOP + i() * ROW_H, width: props.w - 12, height: ROW_H, bgColor: color(at() === selected() ? "selection" : "background") }}>
              <Text class="absolute left-[6] top-[4] w-[16] font-mono text-sm leading-[14]" style={{ textColor: color(at() === selected() ? "accent" : "dark_foreground") }}>{at() === 0 ? "\u{f0415}" : "\u{f09ed}"}</Text>
              <Text class="absolute left-[26] top-[4] h-[14] overflow-hidden font-mono text-sm leading-[14]" style={{ width: props.w - 40, textColor: color(at() === selected() ? "bright_foreground" : "foreground"), ...cjk(label, CJK_SLOT_14) }}>
                {label}
              </Text>
            </View>
          );
        }}
      </For>
    </>
  );
}

function Stage(props: { w: number; h: number }) {
  const split = () => props.w >= 360;
  return (
    <Show when={editing()} fallback={
      <>
        <Rows w={split() ? LIST_W : props.w} h={props.h} />
        <Show when={split()}>
          <View class="absolute top-0 w-[1]" style={{ insetL: LIST_W, height: props.h, bgColor: color("muted") }} />
          <Page chars={() => [...preview()]} title={names()[selected() - 1]?.replace(/\.md$/, "") ?? "Enter opens a new note"} x={LIST_W} w={props.w - LIST_W} h={props.h} />
        </Show>
      </>
    }>
      <Page chars={chars} cursor={cursor} title={`${(editing() ?? "").replace(/\.md$/, "")}  (editing)`} x={0} w={props.w} h={props.h} />
    </Show>
  );
}

function select(index: number) {
  const next = Math.max(0, Math.min(rowsOf().length - 1, index));
  if (next === selected()) return;
  setSelected(next);
  loadPreview();
}

register({
  id: "notes",
  title: "Notes",
  icon: "\u{f09ed}",
  Stage,
  keys: () => (editing() ? sink : null),
  hint: () => "↑↓ pick a note · Enter opens it",
  press(button) {
    if (button & BTN.UP) select(selected() - 1);
    else if (button & BTN.DOWN) select(selected() + 1);
    else if (button & BTN.CIRCLE) open(selected());
  },
  shown: reload,
  hidden: save,
});
