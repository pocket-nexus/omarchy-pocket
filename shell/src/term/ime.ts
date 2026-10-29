// Pinyin composition between the touch keyboard and its target. In 中 mode,
// letters and punctuation build a key transcript (PocketJS's IME key codes,
// contracts/spec/ime.ts); omarchy-pocketd evaluates the whole transcript with
// Rime and answers with preedit, five candidates and any committed text.
// Space or a digit picks a candidate, Enter commits the letters as typed,
// Escape drops the composition. A key that can commit waits for its answer;
// keys typed meanwhile follow once the commit is out, so text never reorders.
import { createSignal } from "solid-js";
import { IME, type ImeSnapshot } from "../../../vendor/pocketjs/contracts/spec/ime.ts";
import { request } from "../bridge.ts";

const [chinese, setChinese] = createSignal(false);
const [snapshot, setSnapshot] = createSignal<ImeSnapshot | null>(null);
let keys: number[] = [];
/** keys.length, as a signal: what the strip shows depends on it */
const [typed, setTyped] = createSignal(0);
let revision = 0;
let waiting = false;
const queued: { key: string; emit(text: string): void; pass(): void }[] = [];

export { chinese, snapshot };

export const composing = () => typed() > 0 || snapshot() !== null;

function setKeys(next: number[]) {
  keys = next;
  setTyped(next.length);
}

export function toggleChinese() {
  reset();
  setChinese((on) => !on);
}

function reset() {
  setKeys([]);
  revision++;
  waiting = false;
  queued.length = 0;
  setSnapshot(null);
}

/** Keys Rime takes while composing, by the keyboard's names. */
const NAMED: Record<string, number> = { Backspace: IME.backspace, Enter: IME.enter, Left: IME.left, Right: IME.right, PageUp: IME.pageUp, PageDown: IME.pageDown };
/** A key that can end a composition: its answer must be in before the next key. */
const commits = (code: number) => code === 32 || code === IME.enter || (code >= 48 && code <= 57) || (code >= IME.select && code < IME.select + 5) || /[^a-z]/.test(String.fromCharCode(code));

function evaluate(emit: (text: string) => void) {
  const mine = ++revision;
  request<ImeSnapshot>({ method: "ime", keys: [...keys] }).then(
    (next) => {
      if (mine !== revision) return;
      if (next.commit) emit(next.commit);
      if (next.commit || !next.raw) {
        setKeys([]);
        setSnapshot(next.preedit ? next : null);
      } else setSnapshot(next);
      waiting = false;
      const pending = queued.splice(0);
      for (const q of pending) route(q.key, q.emit, q.pass);
    },
    () => {
      if (mine === revision) reset();
    },
  );
}

/** Takes `key` (a character or a key name) for the composition, or calls
 *  `pass` to send it to the target untouched. `emit` delivers committed text. */
export function route(key: string, emit: (text: string) => void, pass: () => void) {
  if (!chinese()) return pass();
  if (waiting) return void queued.push({ key, emit, pass });
  const active = keys.length > 0;
  let code: number | undefined;
  if ([...key].length === 1) {
    const c = key.charCodeAt(0);
    if (c >= 32 && c <= 126 && (/[a-z]/.test(key) || (active ? true : /[,.;:?!'"()<>[\]\\]/.test(key)))) code = c;
  } else if (active && key === "Escape") return reset();
  else if (active) code = NAMED[key];
  if (code === undefined) return active ? undefined : pass();
  setKeys([...keys, code]);
  if (keys.length > IME.keys) return reset();
  if (commits(code)) waiting = true;
  evaluate(emit);
}

/** A candidate on the strip, by its place on the page. */
export function pick(index: number, emit: (text: string) => void) {
  if (!keys.length || waiting) return;
  setKeys([...keys, IME.select + index]);
  waiting = true;
  evaluate(emit);
}
