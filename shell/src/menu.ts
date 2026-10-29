// The Omarchy menu as data: tools/omarchy-assets.ts turns Omarchy's own
// default/omarchy/omarchy-menu.jsonc into generated/menu.ts. A row with
// children opens them; a row with an action runs it through the Omarchy
// bridge (not wired yet); a row with a provider lists what the provider
// finds on the device (not wired yet).
export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  title: string;
  action: string;
  provider: string;
  when: string;
  children: MenuItem[];
}

export interface MenuLevel {
  title: string;
  items: MenuItem[];
  index: number;
  scroll: number;
}

export const ROOT_TITLE = "Go";

/** Rows whose `when` condition holds. Conditions are shell commands the Omarchy
 * bridge will evaluate; until it exists, conditional rows stay hidden. */
export function shown(items: MenuItem[]): MenuItem[] {
  return items.filter((item) => !item.when);
}

/** The first visible row that keeps `index` inside a window of `rows`. */
export function scrollFor(level: MenuLevel, index: number, rows: number): number {
  if (index < level.scroll) return index;
  if (index >= level.scroll + rows) return index - rows + 1;
  return level.scroll;
}
