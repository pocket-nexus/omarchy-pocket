// Every class the shell draws with a theme colour. tools/omarchy-assets.ts
// replaces each braced colour name with that colour from colors.toml and
// writes generated/classes.ts: PocketJS keys its style table by whole class
// strings, so a theme colour cannot be spliced into a class at run time.
export const C = {
  bar: "absolute left-0 top-0 w-[512] h-[18] bg-[{background}]",
  barText: "absolute top-[2] font-mono text-xs leading-[14] text-[{foreground}]",
  barCenter: "absolute left-0 top-[2] w-[512] text-center font-mono text-xs leading-[14] text-[{foreground}]",
  barRight: "absolute right-[8] top-[2] font-mono text-xs leading-[14] text-[{foreground}]",
  workspace: "absolute top-[2] font-mono text-xs leading-[14] text-[{dark_foreground}]",
  workspaceOn: "absolute top-[2] font-mono text-xs leading-[14] text-[{accent}]",

  deck: "absolute left-0 top-0 w-[512] h-[384] bg-[{darker_background}]",
  crumbs: "absolute left-[12] top-[6] font-mono text-sm leading-[16] text-[{accent}]",
  rule: "absolute left-[8] top-[25] w-[496] h-[1] bg-[{muted}]",
  rowOn: "absolute left-0 top-0 w-[496] h-[22] rounded-sm bg-[{selection}]",
  icon: "absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14] text-[{dark_foreground}]",
  iconOn: "absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14] text-[{accent}]",
  label: "absolute left-[34] top-[4] font-mono text-sm leading-[14] text-[{foreground}]",
  labelOn: "absolute left-[34] top-[4] font-mono text-sm leading-[14] text-[{bright_foreground}]",
  chevron: "absolute right-[8] top-[4] font-mono text-sm leading-[14] text-[{dark_foreground}]",
  footer: "absolute left-0 top-[364] w-[512] h-[20] bg-[{dark_background}]",
  hint: "absolute left-[12] top-[3] font-mono text-xs leading-[14] text-[{dark_foreground}]",

  notice: "absolute left-[96] top-[150] w-[320] h-[84] overflow-hidden rounded-md border-[1] bg-[{background}] border-[{accent}]",
  noticeTitle: "absolute left-[14] top-[12] font-mono text-sm leading-[16] text-[{accent}]",
  noticeBody: "absolute left-[14] top-[36] w-[292] font-mono text-xs leading-[14] text-[{foreground}]",
  noticeNote: "absolute left-[14] top-[62] font-mono text-xs leading-[14] text-[{dark_foreground}]",
} as const;
