// The trackpad's hint along its bottom edge, in lines that fit the pad.

/** JetBrains Mono at text-xs: 0.6 em of 12 points */
const XS_ADVANCE = 7.2;

/** The most lines the hint takes along the pad's bottom edge. */
const HINT_LINES = 3;

const SEPARATOR = " · ";

/** The hint in lines no wider than `width` (the Thor's pad is 289 points
 *  wide, the Duo Lite's 302, the RG DS Plus's 388). Two lines break at the
 *  separator nearest the middle; when either is still too wide, the parts
 *  go on as many lines as they need, as many on a line as fit, at most
 *  HINT_LINES. A part wider than `width` keeps a line of its own. */
export function fitLines(text: string, width: number): string[] {
  const fits = (line: string) => line.length * XS_ADVANCE <= width;
  if (fits(text)) return [text];
  const middle = text.length / 2;
  let best = -1;
  for (let at = text.indexOf(SEPARATOR); at >= 0; at = text.indexOf(SEPARATOR, at + 1)) if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
  if (best < 0) return [text];
  const two = [text.slice(0, best), text.slice(best + SEPARATOR.length)];
  if (two.every(fits)) return two;
  const lines: string[] = [];
  for (const part of text.split(SEPARATOR)) {
    const last = lines.length - 1;
    const joined = last >= 0 ? `${lines[last]}${SEPARATOR}${part}` : part;
    if (last >= 0 && (fits(joined) || lines.length === HINT_LINES)) lines[last] = joined;
    else lines.push(part);
  }
  return lines;
}
