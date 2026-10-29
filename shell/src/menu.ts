// The Omarchy menu as data: tools/omarchy-assets.ts turns Omarchy's own
// default/omarchy/omarchy-menu.jsonc into generated/menu.ts. A row with
// children opens them; a row with a provider opens the rows the provider
// finds on the device (PROVIDERS); a row with an action runs it through
// omarchy-pocketd. `when`, `checked` and `disabled` are shell commands
// omarchy-pocketd evaluates: a row with a `when` shows once its command
// exits 0.
export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  title: string;
  action: string;
  provider: string;
  when: string;
  checked: string;
  disabled: string;
  children: MenuItem[];
  /** a provider row for the value currently set */
  current?: boolean;
}

/** Omarchy's menu providers (plugins/menu/Menu.qml): a bash one-liner that
 *  prints `label\tvalue\tcurrent` rows, and the action for a value. The
 *  apps provider is the daemon's list of terminal applications. */
export const PROVIDERS: Record<string, { script: string; icon: string; action(value: string): string }> = {
  fonts: {
    script: `current=$(omarchy-font-current 2>/dev/null); omarchy-font-list 2>/dev/null | while read -r f; do [[ -z $f ]] && continue; printf '%s\t%s\t%s\n' "$f" "$f" "$current"; done`,
    icon: "\u{f031}",
    action: (value) => `omarchy-font-set ${quote(value)}`,
  },
  "power-profiles": {
    script: `current=$(powerprofilesctl get 2>/dev/null); omarchy-powerprofiles-list 2>/dev/null | while read -r p; do [[ -z $p ]] && continue; printf '%s\t%s\t%s\n' "$p" "$p" "$current"; done`,
    icon: "\u{f040b}",
    action: (value) => `omarchy-powerprofiles-set autodetect ${quote(value)}`,
  },
  kernels: {
    script: `current=$(omarchy-kernel get 2>/dev/null); omarchy-kernel list 2>/dev/null | while read -r k; do [[ -z $k ]] && continue; printf '%s\t%s\t%s\n' "$k" "$k" "$current"; done`,
    icon: "\u{f17c}",
    action: (value) => `omarchy-kernel set ${quote(value)}`,
  },
  languages: {
    script: `current=$(omarchy-language 2>/dev/null); omarchy-language list 2>/dev/null | while IFS=$'\t' read -r name code english; do [[ -z $code ]] && continue; printf '%s\t%s\t%s\t%s\n' "$name" "$code" "$current" "$english"; done`,
    icon: "\u{f1ab}",
    action: (value) => `omarchy-language ${quote(value)}`,
  },
};

export function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A row the menu builds at run time (provider rows). */
export function row(id: string, icon: string, label: string, action: string, current = false): MenuItem {
  return { id, icon, label, title: label, action, provider: "", when: "", checked: "", disabled: "", children: [], current };
}

/** Rows from a provider's `label\tvalue\tcurrent` output. */
export function providerRows(parent: string, provider: string, output: string): MenuItem[] {
  const spec = PROVIDERS[provider]!;
  const rows: MenuItem[] = [];
  const taken = new Set<string>();
  for (const line of output.split("\n")) {
    const [label = "", value = label, current = ""] = line.trim().split("\t");
    if (!label) continue;
    let id = `${parent}.${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    while (taken.has(id)) id += "-";
    taken.add(id);
    rows.push(row(id, spec.icon, label, spec.action(value), value === current));
  }
  return rows;
}

export interface MenuLevel {
  title: string;
  items: MenuItem[];
  /** id of the selected row */
  selected: string;
  /** index of the first row in the window */
  scroll: number;
}

export const ROOT_TITLE = "Go";

/** Condition commands by their result; absent until evaluated. */
export type Truth = Record<string, boolean>;

export function shown(items: MenuItem[], truth: Truth): MenuItem[] {
  return items.filter((item) => !item.when || truth[item.when] === true);
}

/** Every condition command of the rows in `items`. */
export function conditionsOf(items: MenuItem[]): string[] {
  const commands = new Set<string>();
  for (const item of items) for (const c of [item.when, item.checked, item.disabled]) if (c) commands.add(c);
  return [...commands];
}

/** The first visible row that keeps `index` inside a window of `rows`. */
export function scrollFor(scroll: number, index: number, rows: number): number {
  if (index < scroll) return index;
  if (index >= scroll + rows) return index - rows + 1;
  return scroll;
}

/** The ids from the root to the row with `id`, or null. */
export function pathTo(items: MenuItem[], id: string): MenuItem[] | null {
  for (const item of items) {
    if (item.id === id) return [item];
    const below = pathTo(item.children, id);
    if (below) return [item, ...below];
  }
  return null;
}
