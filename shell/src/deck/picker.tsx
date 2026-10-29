// Omarchy's image picker on the deck, with the highlighted image previewed
// as the stage's wallpaper. Two callers open it, as they open Quickshell's
// omarchy.image-picker:
//   `shell summon omarchy.image-picker {"source":"themes"}` (Appearance › Theme):
//       the rows `omarchy-theme-switcher --print-rows` prints; A runs
//       `omarchy-theme-set <name>`
//   `image-selector open <dirs> <rows-b64> <selected> <selection> <done> ...`
//       (omarchy-menu-images: Appearance › Background and other image menus):
//       A writes the image's path to the selection file, then the done file
//       ends the caller's wait; B leaves the selection empty.
// Labels, names and row parsing are Omarchy's ImagePickerModel.
import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { run } from "../bridge.ts";
import { C } from "../classes.ts";
import { labelForPath, loadRows, nameForPath } from "../generated/image-picker-model.js";
import { previewWallpaper, restoreWallpaper } from "../stage/wallpaper.tsx";
import { serve } from "../system.ts";
import { toast } from "../stage/toasts.tsx";
import { color } from "../theme.ts";
import { BODY_H } from "./geometry.ts";
import { createList, List } from "./list.tsx";
import type { TouchFrame } from "../touch.ts";

interface Row {
  filePath: string;
  thumbnailPath: string;
}
type Mode = { kind: "themes" } | { kind: "select"; selectionFile: string; doneFile: string };

const HEADER_H = 26;
const ROW_H = 22;
const ROWS = Math.floor((BODY_H - HEADER_H - 4) / ROW_H);
const PREVIEW_AFTER = 0.25;
const ERROR = "\u{f015a}";

const [mode, setMode] = createSignal<Mode | null>(null);
const [rows, setRows] = createSignal<Row[]>([]);
const [index, setIndex] = createSignal(0);
const picker = createList(ROW_H, HEADER_H, ROWS);
let previewToken = 0;

export const pickerOpen = () => mode() !== null;

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function show(next: Mode, rowsText: string, selected: string) {
  const list = loadRows(rowsText) as Row[];
  if (!list.length) {
    toast({ icon: ERROR, title: "Images", body: "Nothing to pick from", tone: "error" });
    if (next.kind === "select") void run(`: > ${quote(next.doneFile)}`);
    return;
  }
  const at = Math.max(0, list.findIndex((r) => r.filePath === selected || r.thumbnailPath === selected));
  setRows(list);
  setMode(next);
  picker.reset();
  select(at);
}

function select(at: number) {
  const list = rows();
  const i = Math.max(0, Math.min(list.length - 1, at));
  setIndex(i);
  picker.reveal(i, list.length);
  const token = ++previewToken;
  after(PREVIEW_AFTER, () => token === previewToken && previewWallpaper(list[i]!.thumbnailPath));
}

function close(apply: boolean) {
  const m = mode();
  const row = rows()[index()];
  setMode(null);
  previewToken++;
  if (!m) return;
  if (m.kind === "themes") {
    if (apply && row) void run(`omarchy-theme-set ${quote(nameForPath(row.filePath))}`);
    else restoreWallpaper();
    return;
  }
  const write = apply && row ? `printf '%s\\n' ${quote(row.filePath)} > ${quote(m.selectionFile)}; ` : "";
  void run(`${write}: > ${quote(m.doneFile)}`);
  if (!apply) restoreWallpaper();
}

export function openThemePicker() {
  run("omarchy-theme-switcher --print-rows").then(
    (result) =>
      run("cat ~/.local/state/omarchy/current/theme.name").then((name) => {
        const current = name.stdout.trim();
        const selected = (loadRows(result.stdout) as Row[]).find((r) => nameForPath(r.filePath) === current)?.filePath ?? "";
        show({ kind: "themes" }, result.stdout, selected);
      }),
    () => {},
  );
}

serve("image-selector", {
  open: (_dirs, rowsB64, selected, selectionFile, doneFile) => {
    show({ kind: "select", selectionFile: selectionFile ?? "", doneFile: doneFile ?? "" }, decode(rowsB64 ?? ""), selected ?? "");
    return "ok";
  },
  preload: () => "ok",
  cancel: () => (close(false), "ok"),
  ping: () => "ok",
});

/** Base64 to UTF-8 text (image paths). */
function decode(b64: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of b64) {
    const digit = alphabet.indexOf(c);
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    let cp = n === 1 ? b : b & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) cp = (cp << 6) | (bytes[i + k]! & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

export function pickerPress(key: number) {
  if (key & BTN.UP) select(index() - 1);
  else if (key & BTN.DOWN) select(index() + 1);
  else if (key & BTN.ZL) select(index() - ROWS);
  else if (key & BTN.ZR) select(index() + ROWS);
  else if (key & BTN.CIRCLE) close(true);
  else if (key & BTN.CROSS) close(false);
}

/** The picker's fingers (body coordinates): a tap on the header cancels, a
 *  tap previews a row and a tap on the previewed row applies it, a drag scrolls. */
export function pickerTouch(frame: TouchFrame) {
  for (const tap of frame.taps) if (!tap.moved && tap.y < HEADER_H) return close(false);
  picker.touch(frame, rows().length, (at) => (at === index() ? close(true) : select(at)));
}

export function Picker() {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>
        {mode()?.kind === "themes" ? "Theme" : "Image"}
      </Text>
      <Text class="absolute right-[12] top-[6] font-mono text-xs leading-[16]" style={{ textColor: color("dark_foreground") }}>
        {`${index() + 1}/${rows().length}   A apply   B cancel`}
      </Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <List state={picker} items={rows} top={HEADER_H} rowH={ROW_H} selected={index}>
        {(row, at) => (
          <Text class={C.label} style={{ insetL: 12, textColor: color(at === index() ? "bright_foreground" : "foreground") }}>
            {labelForPath(row().filePath)}
          </Text>
        )}
      </List>
    </View>
  );
}
