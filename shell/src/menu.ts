// The Omarchy menu as data: tools/omarchy-assets.ts turns Omarchy's own
// default/omarchy/omarchy-menu.jsonc into generated/menu.ts. A row with
// children opens them; a row with an action runs it through omarchy-pocketd;
// a row with a provider lists what the provider finds on the device (not
// wired yet). `when`, `checked` and `disabled` are shell commands
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
