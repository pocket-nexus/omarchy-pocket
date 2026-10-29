// Layout and type for every element the shell draws. Colours are not here:
// each element takes them from the palette at run time (theme.ts) through its
// style, so a theme switch repaints without a new package. Fixed-size panes
// carry `contain-strict`: each is its own layout region, so a change inside
// one (a clock's seconds, a terminal row) re-solves that pane, not the tree.
export const C = {
  bar: "absolute left-0 top-0 w-[512] h-[18] contain-strict",
  barText: "absolute top-[2] font-mono text-xs leading-[14]",
  barCenter: "absolute left-0 top-[2] w-[512] text-center font-mono text-xs leading-[14]",
  barRight: "absolute right-[8] top-[2] font-mono text-xs leading-[14]",

  deck: "absolute left-0 top-0 w-[512] h-[318] contain-strict",
  card: "absolute left-0 top-0 w-[360] h-[296] contain-strict",
  cardRule: "absolute left-[8] top-[25] w-[344] h-[1]",
  crumbs: "absolute left-[12] top-[6] font-mono text-sm leading-[16]",
  rule: "absolute left-[8] top-[25] w-[496] h-[1]",
  row: "absolute left-[8] w-[496] h-[22]",
  rowOn: "absolute left-0 top-0 w-[496] h-[22] rounded-sm",
  icon: "absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14]",
  label: "absolute left-[34] top-[4] font-mono text-sm leading-[14]",
  chevron: "absolute right-[8] top-[4] font-mono text-sm leading-[14]",
  footer: "absolute left-0 top-[298] w-[512] h-[20]",
  hint: "absolute left-[12] top-[3] font-mono text-xs leading-[14]",

  osd: "absolute top-[288] h-[48] overflow-hidden rounded-md border-[1]",
  osdIcon: "absolute left-[12] top-[10] w-[28] text-center text-2xl leading-[28]",
  osdTrack: "absolute left-[52] top-[22] w-[120] h-[4]",
  osdValue: "absolute right-[12] top-[15] font-mono text-base leading-[18]",
  osdMessage: "absolute left-[48] top-[15] font-mono text-base leading-[18]",

  toast: "absolute right-[8] w-[248] h-[52] overflow-hidden rounded-md border-[1]",
  toastIcon: "absolute left-[10] top-[8] w-[18] font-mono text-sm leading-[16]",
  toastTitle: "absolute left-[32] top-[8] w-[136] h-[16] overflow-hidden font-mono text-sm leading-[16]",
  toastKeys: "absolute right-[8] top-[9] font-mono text-xs leading-[14]",
  toastBody: "absolute left-[32] top-[28] w-[206] h-[16] overflow-hidden font-mono text-xs leading-[14]",

  cover: "absolute left-0 top-0 w-[512] h-[384]",
  lockIcon: "absolute left-0 top-[118] w-[512] text-center text-2xl leading-[28]",
  lockClock: "absolute left-0 top-[160] w-[512] text-center text-2xl leading-[28]",
  lockDate: "absolute left-0 top-[202] w-[512] text-center font-mono text-sm leading-[16]",
} as const;
