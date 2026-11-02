// Builds /vs/iphone-duo from one table of figures: three treatments of the same
// comparison (the report, the keynote, the paper) and the to-scale drawing of an
// iPhone Duo, from Apple's published dimensions. The RG DS Plus beside it is
// rendered from the page's own 3D model.
//
//   bun site/vs.ts
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("public/vs/iphone-duo/", import.meta.url).pathname;
mkdirSync(`${OUT}b`, { recursive: true });
mkdirSync(`${OUT}c`, { recursive: true });

const BUY = "https://anbernic.com/products/rg-ds-plus?sca_ref=12680456.0FG7ivC2oS";
const SOURCES = [
  ["Apple, iPhone Duo", "https://www.apple.com/iphone-duo/"],
  ["Wikipedia, iPhone Duo (dimensions, memory, battery)", "https://en.wikipedia.org/wiki/IPhone_Duo"],
  ["Tom's Guide, iPhone Duo benchmarks (Geekbench 6: 4,722 / 12,708)", "https://www.tomsguide.com/phones/iphones/iphone-duo-full-benchmarks-the-worlds-fastest-foldable-but-how-does-it-stack-up-to-iphone-18-pro"],
  ["TechRepublic, iPhone Duo cheat sheet ($1,999)", "https://www.techrepublic.com/article/news-iphone-duo-cheat-sheet/"],
  ["Geekbench Browser, an RK3568 board (Geekbench 6: 175 / 495)", "https://browser.geekbench.com/v6/cpu/15479020"],
  ["Geekbench Browser, an RK3568 board (single core 176)", "https://browser.geekbench.com/v6/cpu/baseline/14207809"],
  ["Anbernic, RG DS Plus ($94.99 list)", BUY],
  ["Retro Handhelds, RG DS Plus specs (RK3568, 1 GB, 344 g, 4000 mAh)", "https://retrohandhelds.gg/anbernic-rg-ds-plus-unboxing-reveals-full-specs-and-more/"],
];

const PRICE = { duo: 1999, rg: 94.99 };
const GB = { duo: { s: 4722, m: 12708 }, rg: { s: 176, m: 495 } };
const fleet = Math.floor(PRICE.duo / PRICE.rg); // 21
const x = (a: number, b: number) => `${(a / b).toFixed(a / b >= 10 ? (Number.isInteger(+(a / b).toFixed(1)) ? 0 : 1) : 1)}×`;

type Row = [label: string, duo: string, rg: string, winner: "duo" | "rg" | "tie", note?: string];
const ROWS: { title: string; rows: Row[] }[] = [
  { title: "Performance", rows: [
    ["Geekbench 6, single core", "4,722", "176", "duo", x(GB.duo.s, GB.rg.s)],
    ["Geekbench 6, multi core", "12,708", "495", "duo", x(GB.duo.m, GB.rg.m)],
    ["Processor", "A20 Pro, 6 cores, 2 nm", "RK3568, 4 Cortex-A55, 22 nm", "duo"],
    ["Memory", "12 GB", "1 GB", "duo", "12×"],
    ["Display refresh", "up to 120 Hz", "60 Hz", "duo", "2×"],
    ["Battery life", "up to 24 h", "about 6 h", "duo", "4×"],
  ]},
  { title: "Hardware", rows: [
    ["Weight", "254 g", "344 g", "duo", "90 g less"],
    ["Cellular", "5G", "none", "duo"],
    ["Cameras", "yes", "none", "duo"],
    ["Screens you can see at once", "1", "2", "rg"],
    ["D-pad", "0", "1", "rg"],
    ["Analog stick", "0", "1", "rg"],
    ["Face and shoulder buttons", "0", "8", "rg"],
    ["microSD slots", "0", "2", "rg"],
    ["Built-in stylus", "no", "yes", "rg"],
    ["Headphone jack", "no", "yes", "rg"],
  ]},
  { title: "What you do on it", rows: [
    ["YouTube", "yes", "yes", "tie"],
    ["X", "yes", "yes", "tie"],
    ["GitHub", "yes", "yes", "tie"],
    ["Tailscale", "yes", "yes", "tie"],
    ["VPN or proxy", "yes", "yes, mihomo", "tie"],
    ["Palmtop mode, keyboard on the lower half", "yes", "yes", "tie"],
    ["Voice input on the device", "yes", "yes", "tie"],
  ]},
  { title: "The bill", rows: [
    ["Price", "$1,999", "$94.99", "rg", x(PRICE.duo, PRICE.rg)],
    ["Price per YouTube", "$1,999", "$94.99", "rg", x(PRICE.duo, PRICE.rg)],
    ["Single-core points per dollar", (GB.duo.s / PRICE.duo).toFixed(2), (GB.rg.s / PRICE.rg).toFixed(2), "duo"],
  ]},
];
const all = ROWS.flatMap((g) => g.rows);
const wins = (w: string) => all.filter((r) => r[3] === w).length;

// ---------- the drawing ----------
function duoSvg() {
  const W = 1178, H = 1646, M = 26, SX = M, SW = W - 2 * M, SY = M, SH = H - 2 * M, FOLD = H / 2;
  const out: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, r: number, fill: string, extra = "") => out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fill}" ${extra}/>`);
  const text = (x: number, y: number, s: string, size: number, fill: string, anchor = "middle") => out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-family="-apple-system,'SF Pro Text',Helvetica,Arial,sans-serif">${s}</text>`);
  rect(0, 0, W, H, 92, "url(#edge)");
  rect(5, 5, W - 10, H - 10, 88, "#0b0b0d");
  out.push(`<clipPath id="screen"><rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="68"/></clipPath><g clip-path="url(#screen)">`);
  // the upper half: a page of videos, in no one's colours
  rect(SX, SY, SW, FOLD - SY, 0, "#f6f3ef");
  rect(SX, SY, SW, 84, 0, "#ffffff");
  rect(SX + 50, SY + 34, 60, 22, 8, "#d8d3cc");
  rect(SX + 300, SY + 26, SW - 600, 38, 19, "#ece8e2");
  const tints = ["#e8b7a6", "#b7c9e8", "#c8e0bd", "#e6d3a3", "#d6bfe6", "#a9d6d4"];
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3), tw = (SW - 100 - 2 * 30) / 3, th = tw * 0.56;
    const tx = SX + 50 + col * (tw + 30), ty = SY + 118 + row * (th + 110);
    rect(tx, ty, tw, th, 16, tints[i]!);
    rect(tx, ty + th + 16, tw * 0.9, 16, 6, "#3b3833");
    rect(tx, ty + th + 44, tw * 0.55, 13, 6, "#a8a297");
  }
  // the lower half: a function row, keys and a trackpad
  rect(SX, FOLD, SW, H - FOLD, 0, "#111114");
  const chips = ["esc", "‹ Back", "› Forward", "Reload", "New Tab", "Address"];
  const cw = (SW - 44 - 5 * 8) / 6;
  chips.forEach((c, i) => { const cx = SX + 22 + i * (cw + 8); rect(cx, FOLD + 26, cw, 46, 12, "#26262b"); text(cx + cw / 2, FOLD + 56, c, 21, "#d9d9de"); });
  const ROWS_K = [["q","w","e","r","t","y","u","i","o","p"],["a","s","d","f","g","h","j","k","l"],["⇧","z","x","c","v","b","n","m","⌫"]];
  const KW = (SW - 44) / 10, KH = 62;
  ROWS_K.forEach((row, r) => {
    const inset = r === 1 ? KW / 2 : 0;
    let kx = SX + 22 + inset;
    row.forEach((k) => {
      const wide = k === "⇧" || k === "⌫";
      const w = wide ? KW * 1.5 : KW;
      rect(kx + 3, FOLD + 84 + r * KH + 3, w - 6, KH - 7, 10, "#2c2c32");
      text(kx + w / 2, FOLD + 84 + r * KH + 41, k, 26, "#f2f2f4");
      kx += w;
    });
  });
  rect(SX + 22 + 3, FOLD + 84 + 3 * KH + 3, KW * 2 - 6, KH - 7, 10, "#232328");
  rect(SX + 22 + KW * 2 + 3, FOLD + 84 + 3 * KH + 3, KW * 6 - 6, KH - 7, 10, "#2c2c32");
  rect(SX + 22 + KW * 8 + 3, FOLD + 84 + 3 * KH + 3, KW * 2 - 6, KH - 7, 10, "#232328");
  const padY = FOLD + 84 + 4 * KH + 14;
  rect(SX + 170, padY, SW - 340, H - M - 22 - padY, 30, "#1b1b1f");
  for (const [cx, cy] of [[SX + 86, H - M - 124], [SX + 86, H - M - 58], [SX + SW - 86, padY + 34], [SX + SW - 86, padY + 100]] as const) out.push(`<circle cx="${cx}" cy="${cy}" r="27" fill="#2a2a30"/>`);
  out.push(`<rect x="${SX}" y="${FOLD - 7}" width="${SW}" height="14" fill="url(#crease)"/>`);
  out.push("</g>");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="An iPhone Duo, open, drawn from its published dimensions">
<defs><linearGradient id="edge" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#b9bbc0"/><stop offset=".5" stop-color="#7b7d83"/><stop offset="1" stop-color="#c8cacf"/></linearGradient>
<linearGradient id="crease" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
${out.join("\n")}
</svg>`;
}
writeFileSync(`${OUT}iphone-duo.svg`, duoSvg());

// ---------- shared pieces ----------
const head = (title: string, description: string, canonical: string, style: string, fonts: string, indexable: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${indexable ? "" : '<meta name="robots" content="noindex">\n'}<link rel="canonical" href="https://omapocket.org${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Omarchy Pocket">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://omapocket.org/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<style>${FIGURE_CSS}${style}</style>
</head>`;
const FIGURE_CSS = `
*{box-sizing:border-box;margin:0}
.versus{display:flex;align-items:flex-end;gap:clamp(10px,3vw,40px)}
.versus figure{min-width:0}
.versus figure:first-child{flex:117.8 1 0}
.versus figure:last-child{flex:167 1 0}
.versus img{display:block;width:100%;height:auto}
.versus figcaption{margin-top:12px}
.bars{display:grid;gap:18px}
.bar-row b{display:block;margin-bottom:6px}
.track{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:4px}
.track i{display:block;height:var(--h,16px);border-radius:3px;width:var(--w);min-width:2px}
`;
const FIGURE = (label = true) => `<div class="versus">
  <figure><img src="/vs/iphone-duo/iphone-duo.svg" width="1178" height="1646" alt="An iPhone Duo, open: a keyboard and trackpad on the lower half of its one folding screen">${label ? `<figcaption><b>iPhone Duo</b><span>117.8 × 164.6 mm · 254 g · $1,999</span></figcaption>` : ""}</figure>
  <figure><img src="/vs/iphone-duo/rg-ds-plus.webp" width="1000" height="1078" alt="An RG DS Plus, open, running Omarchy Pocket: a keyboard and trackpad on its lower screen">${label ? `<figcaption><b>RG DS Plus with Omarchy Pocket</b><span>167 × 181 mm · 344 g · $94.99</span></figcaption>` : ""}</figure>
</div>`;
const bar = (label: string, duo: number, rg: number, duoText: string, rgText: string) => {
  const top = Math.max(duo, rg);
  return `<div class="bar-row"><b>${label}</b>
  <div class="track"><i class="d" style="--w:${((duo / top) * 100).toFixed(1)}%"></i><span>${duoText}</span></div>
  <div class="track"><i class="r" style="--w:${((rg / top) * 100).toFixed(1)}%"></i><span>${rgText}</span></div></div>`;
};
const BARS = [
  bar("Geekbench 6, single core", GB.duo.s, GB.rg.s, "4,722", "176"),
  bar("Geekbench 6, multi core", GB.duo.m, GB.rg.m, "12,708", "495"),
  bar("Memory", 12, 1, "12 GB", "1 GB"),
  bar("Price", PRICE.duo, PRICE.rg, "$1,999", "$94.99"),
].join("\n");
const SOURCE_LIST = SOURCES.map(([t, u]) => `<li><a href="${u}"${u === BUY ? ' rel="sponsored noopener"' : ""}>${t}</a></li>`).join("\n");
const LEGAL = "iPhone Duo is a trademark of Apple Inc. This page is not affiliated with or endorsed by Apple or Anbernic. The drawing of the iPhone Duo is ours, to scale from published dimensions; we did not test one.";

// ---------- A: the report ----------
const table = ROWS.map((g) => `<tbody><tr class="group"><th colspan="4">${g.title}</th></tr>
${g.rows.map(([label, duo, rg, w, note]) => `<tr><th scope="row">${label}</th><td class="${w === "duo" ? "win" : ""}">${duo}</td><td class="${w === "rg" ? "win" : ""}">${rg}</td><td class="note">${w === "tie" ? "Same" : (note ?? "")}</td></tr>`).join("\n")}
</tbody>`).join("\n");
writeFileSync(`${OUT}index.html`, head("iPhone Duo vs Omarchy Pocket: comparative report", "A serious comparison of a $1,999 foldable and a $94.99 handheld. The iPhone Duo is 26.8 times faster. Both open YouTube.", "/vs/iphone-duo/", `
:root{--paper:#f6f4ee;--ink:#17161a;--soft:#5b5852;--rule:#cfcabe;--mark:#b4351f;--duo:#6d7078;--rg:#c47a16}
html{background:var(--paper);color-scheme:light}
body{color:var(--ink);font:17px/1.5 "IBM Plex Sans",system-ui,sans-serif}
a{color:inherit;text-underline-offset:3px}
.top{display:flex;justify-content:space-between;gap:12px;padding:14px clamp(16px,4vw,40px);border-bottom:2px solid var(--ink);font:500 13px/1.3 "IBM Plex Mono",monospace}
.top a{text-decoration:none}
main{max-width:1020px;margin:0 auto;padding:clamp(24px,5vw,56px) clamp(16px,4vw,40px)}
.kicker{font:500 13px/1.3 "IBM Plex Mono",monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--mark)}
h1{margin-top:10px;font:600 clamp(36px,6vw,68px)/1.02 "Source Serif 4",Georgia,serif;letter-spacing:-.02em;text-wrap:balance}
.dek{margin-top:16px;max-width:42rem;font:400 clamp(18px,2vw,22px)/1.35 "Source Serif 4",Georgia,serif;color:var(--soft);text-wrap:pretty}
h2{margin:44px 0 14px;padding-top:12px;border-top:2px solid var(--ink);font:600 26px/1.15 "Source Serif 4",Georgia,serif}
.score{display:grid;grid-template-columns:repeat(3,1fr);margin-top:28px;border:2px solid var(--ink)}
.score div{padding:14px 16px}
.score div+div{border-left:1px solid var(--rule)}
.score b{display:block;font:600 clamp(36px,6vw,58px)/1 "Source Serif 4",Georgia,serif}
.score span{display:block;font:500 12.5px/1.3 "IBM Plex Mono",monospace;color:var(--soft)}
.versus{margin-top:6px}
.versus figcaption b{display:block;font:600 15px/1.25 "IBM Plex Sans",sans-serif}
.versus figcaption span{display:block;font:400 12.5px/1.4 "IBM Plex Mono",monospace;color:var(--soft)}
.fig{margin-top:12px;font:400 13px/1.4 "IBM Plex Mono",monospace;color:var(--soft)}
.bar-row b{font:600 14px/1.3 "IBM Plex Sans",sans-serif}
.track span{font:500 13px/1 "IBM Plex Mono",monospace;width:68px;text-align:right}
.track .d{background:var(--duo)}.track .r{background:var(--rg)}
.legend{display:flex;gap:16px;font:400 12.5px/1.3 "IBM Plex Mono",monospace;margin-bottom:14px}
.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.scroll{overflow-x:auto}
table{width:100%;min-width:560px;border-collapse:collapse;font-size:15px}
thead th{font:600 13px/1.3 "IBM Plex Sans",sans-serif;text-align:left;padding:8px 10px;border-bottom:2px solid var(--ink)}
tbody th{font-weight:400;text-align:left}
td,tbody th{padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top}
.group th{padding-top:20px;font:500 12.5px/1.3 "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--mark)}
td.win{font-weight:600;background:rgba(196,122,22,.12)}
.note{font:400 12.5px/1.5 "IBM Plex Mono",monospace;color:var(--soft);white-space:nowrap}
.verdict{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:14px}
.verdict div{padding:18px;border:1px solid var(--ink);background:#fff}
.verdict b{display:block;font:500 12.5px/1.3 "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--mark);margin-bottom:8px}
.verdict p{font:400 18px/1.35 "Source Serif 4",Georgia,serif}
.fleet{margin-top:10px}
.cta{display:inline-block;margin-top:18px;padding:13px 18px;background:var(--ink);color:var(--paper);font:600 15px/1 "IBM Plex Sans",sans-serif;text-decoration:none}
ol.src{padding-left:20px;font-size:14px;color:var(--soft);display:grid;gap:4px}
.legal{margin-top:24px;font-size:12.5px;color:var(--soft)}
`, "family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600", true) + `
<body>
<div class="top"><a href="/">← Omarchy Pocket</a><span>Comparative Test Report No. 001 · 2 Nov 2026</span></div>
<main>
<p class="kicker">Folding pocket computers</p>
<h1>iPhone Duo vs Omarchy Pocket</h1>
<p class="dek">We compared a $1,999 foldable with a $94.99 handheld on ${all.length} lines. The score is close. The computers are not.</p>
<div class="score"><div><b>${wins("duo")}</b><span>lines to the iPhone Duo</span></div><div><b>${wins("rg")}</b><span>lines to the RG DS Plus</span></div><div><b>${wins("tie")}</b><span>lines the same</span></div></div>

<h2>Figure 1. The subjects, open</h2>
${FIGURE()}
<p class="fig">Drawn to one scale, a keyboard on the lower half of each. The iPhone Duo folds along its one screen; the RG DS Plus has two, and a hinge.</p>

<h2>Figure 2. Measured difference</h2>
<div class="legend"><span><i style="background:var(--duo)"></i>iPhone Duo</span><span><i style="background:var(--rg)"></i>RG DS Plus</span></div>
<div class="bars">${BARS}</div>

<h2>Table 1. Every line</h2>
<div class="scroll"><table>
<thead><tr><th></th><th>iPhone Duo</th><th>RG DS Plus</th><th></th></tr></thead>
${table}
</table></div>

<h2>Smoothness</h2>
<p>The iPhone Duo refreshes at up to 120 Hz on a chip that scores 4,722. On the RG DS Plus, Omarchy Pocket moves windows at 60 fps on a chip that scores 176, with 557 MB of its 953 MB free while Tailscale and mihomo run. It replaces the desktop graphics stack with one <a href="https://pocketjs.dev/">PocketJS</a> process. Both are smooth. One had less to work with.</p>

<h2>What $1,999 buys instead</h2>
<p class="fleet">${fleet} RG DS Plus units: ${fleet * 4} cores, ${fleet} GB of memory, ${fleet * 2} screens, ${(fleet * 344 / 1000).toFixed(1)} kg. Their Geekbench multi-core scores add up to ${(fleet * GB.rg.m).toLocaleString("en")}, which is not how Geekbench works, and is still less than one iPhone Duo.</p>

<h2>Recommendation</h2>
<div class="verdict">
<div><b>Best computer</b><p>iPhone Duo. It is faster, lighter and thinner, lasts longer and has a camera and a modem. It should: it costs ${x(PRICE.duo, PRICE.rg)} as much.</p></div>
<div><b>Best value for opening YouTube</b><p>RG DS Plus. It also opens X and GitHub, and joins your tailnet. It has a D-pad.</p><a class="cta" href="${BUY}" rel="sponsored noopener" target="_blank">Get an RG DS Plus ↗</a></div>
</div>

<h2>Sources</h2>
<ol class="src">${SOURCE_LIST}</ol>
<p class="legal">${LEGAL} The RG DS Plus's memory and frame rate were measured on our device on 2 Nov 2026; its Geekbench figures come from RK3568 boards, not from this handheld.</p>
</main>
</body>
</html>
`);

// ---------- B: the keynote ----------
const tinyFleet = Array.from({ length: fleet }, () => `<img src="/vs/iphone-duo/rg-ds-plus.webp" width="1000" height="1078" alt="" loading="lazy">`).join("");
writeFileSync(`${OUT}b/index.html`, head("Same YouTube · iPhone Duo vs Omarchy Pocket", "26.8 times the speed. 21 times the price. Same YouTube.", "/vs/iphone-duo/b/", `
:root{--ink:#f5f5f7;--soft:#8a8a92;--line:#2a2a2f;--gold:#ffc46b}
html{background:#000;color-scheme:dark}
body{color:var(--ink);font:18px/1.45 "Inter",system-ui,sans-serif;overflow-x:hidden}
a{color:inherit}
.top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;padding:18px clamp(18px,4vw,44px);font-size:14px;color:var(--soft)}
.top a{text-decoration:none}
section{min-height:92vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:72px clamp(18px,5vw,60px)}
h1,h2{font-weight:700;letter-spacing:-.04em;text-wrap:balance}
h1{font-size:clamp(46px,9.5vw,128px);line-height:.98}
h2{font-size:clamp(38px,7vw,92px);line-height:1}
.num{font-size:clamp(90px,24vw,300px);font-weight:700;letter-spacing:-.06em;line-height:.92}
.num.g{color:var(--gold)}
.sub{margin-top:18px;max-width:34rem;font-size:clamp(18px,2.2vw,26px);line-height:1.3;color:var(--soft);text-wrap:balance}
.versus{width:min(100%,920px);margin-top:44px;text-align:left}
.versus figcaption b{display:block;font-size:15px;font-weight:600}
.versus figcaption span{display:block;font-size:13px;line-height:1.35;color:var(--soft)}
.same{display:grid;gap:4px;margin-top:8px;font-size:clamp(34px,6.4vw,80px);font-weight:700;letter-spacing:-.035em;line-height:1.06}
.same small{display:block;font-size:clamp(14px,1.5vw,18px);font-weight:400;letter-spacing:0;color:var(--soft);margin:18px auto 0;max-width:30rem;line-height:1.35}
.barsw{width:min(100%,760px);margin-top:44px;text-align:left}
.bar-row b{font-size:15px;font-weight:600}
.track span{font-size:14px;font-variant-numeric:tabular-nums;width:72px;text-align:right;color:var(--soft)}
.track i{--h:18px}
.track .d{background:#8e8e96}.track .r{background:var(--gold)}
.fleet{display:grid;grid-template-columns:repeat(7,1fr);gap:clamp(6px,1.4vw,14px);width:min(100%,760px);margin-top:36px}
.fleet img{display:block;width:100%;height:auto}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;width:min(100%,760px);margin-top:30px}
.stats b{display:block;font-size:clamp(26px,4vw,44px);font-weight:700;letter-spacing:-.03em}
.stats span{font-size:13px;color:var(--soft)}
.cta{display:inline-block;margin-top:30px;padding:15px 24px;border-radius:999px;background:var(--gold);color:#201008;font-weight:600;text-decoration:none}
.fine{padding:0 clamp(18px,5vw,60px) 40px;max-width:760px;margin:0 auto;font-size:12.5px;color:var(--soft)}
.fine ol{padding-left:18px;margin:10px 0}
@media (max-width:560px){.stats{grid-template-columns:repeat(2,1fr)}}
`, "family=Inter:wght@400;600;700", false) + `
<body>
<div class="top"><a href="/">Omarchy Pocket</a><a href="/demo/">Live demo</a></div>
<section><h1>Two folding computers.</h1><p class="sub">One of them is an iPhone.</p>${FIGURE()}</section>
<section><div class="num">${x(GB.duo.s, GB.rg.s)}</div><p class="sub">The iPhone Duo's single-core speed, compared with the RG DS Plus. 4,722 points to 176.</p></section>
<section><div class="num">12×</div><p class="sub">The memory. 12 GB to 1 GB.</p></section>
<section><div class="barsw bars">${BARS}</div></section>
<section><h2>And on both of them:</h2><div class="same"><span>YouTube.</span><span>X.</span><span>GitHub.</span><span>Tailscale.</span><span>A VPN.</span><span>A keyboard on the lower half.</span><small>The iPhone Duo has the App Store. Omarchy Pocket has <a href="https://oma.pocket.nexus/">applets</a> built with <a href="https://pocketjs.dev/">PocketJS</a>.</small></div></section>
<section><div class="num">176</div><p class="sub">Geekbench points. Omarchy Pocket moves its windows at 60 fps on them, with 557 of 953 MB free while Tailscale and a proxy run.</p></section>
<section><div class="num g">${x(PRICE.duo, PRICE.rg)}</div><p class="sub">The price. $1,999 to $94.99.</p></section>
<section><h2>Or, for one iPhone Duo:</h2><div class="fleet">${tinyFleet}</div><div class="stats"><div><b>${fleet * 4}</b><span>cores</span></div><div><b>${fleet}&nbsp;GB</b><span>of memory</span></div><div><b>${fleet * 2}</b><span>screens</span></div><div><b>${(fleet * 344 / 1000).toFixed(1)}&nbsp;kg</b><span>in your pocket</span></div></div><p class="sub">Together they score ${(fleet * GB.rg.m).toLocaleString("en")}, if Geekbench added up, which it does not. One iPhone Duo scores 12,708.</p></section>
<section><h2>The iPhone Duo is the better computer.</h2><p class="sub">This one has a D-pad.</p><a class="cta" href="${BUY}" rel="sponsored noopener" target="_blank">Get an RG DS Plus for $94.99 ↗</a></section>
<div class="fine"><ol>${SOURCE_LIST}</ol><p>${LEGAL} Geekbench figures for the RG DS Plus come from RK3568 boards, not from this handheld.</p></div>
</body>
</html>
`);

// ---------- C: the paper ----------
const paperRows = ROWS.slice(0, 2).flatMap((g) => g.rows).slice(0, 8);
writeFileSync(`${OUT}c/index.html`, head("On the Equivalence of a $1,999 and a $94.99 Computer for the Purpose of Opening YouTube", "A paper. We compare the iPhone Duo and an RG DS Plus running Omarchy Pocket and find that they differ by a factor of 26.8 and do the same things.", "/vs/iphone-duo/c/", `
:root{--ink:#111;--soft:#555;--rule:#111}
html{background:#fff;color-scheme:light}
body{color:var(--ink);font:15.5px/1.42 "STIX Two Text","Times New Roman",serif}
a{color:#1a3e8c}
.page{max-width:900px;margin:0 auto;padding:clamp(20px,5vw,56px) clamp(16px,4vw,32px)}
.arx{font:12px/1.3 "IBM Plex Mono",monospace;color:var(--soft);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:26px}
.arx a{color:inherit}
h1{font:600 clamp(24px,3.6vw,33px)/1.16 "STIX Two Text",serif;text-align:center;text-wrap:balance}
.authors{margin-top:14px;text-align:center;font-size:15px}
.authors small{display:block;font-size:13px;color:var(--soft);font-style:italic}
.abstract{margin:22px auto 8px;max-width:640px;font-size:14px;text-align:justify}
.abstract b{font-weight:700}
.cols{columns:2;column-gap:30px;margin-top:22px;text-align:justify;hyphens:auto}
.cols h2{font:700 15.5px/1.2 "STIX Two Text",serif;margin:16px 0 6px;break-after:avoid;text-align:left}
.cols p{margin-bottom:8px}
.cols p+p{text-indent:1.1em}
figure.wide,.tbl{margin:22px 0;break-inside:avoid}
.versus{max-width:640px;margin:0 auto}
.cap{margin-top:10px;font-size:13px;text-align:center}
.versus figcaption{display:none}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:lining-nums tabular-nums}
.tbl{overflow-x:auto}
caption{caption-side:top;font-size:13px;margin-bottom:6px;text-align:center}
thead th{border-top:1.5px solid var(--rule);border-bottom:.75px solid var(--rule);padding:4px 8px;text-align:left;font-weight:600}
tbody td,tbody th{padding:3px 8px;text-align:left;font-weight:400}
tbody tr:last-child td,tbody tr:last-child th{border-bottom:1.5px solid var(--rule)}
.bars{gap:10px;max-width:560px;margin:0 auto}
.bar-row b{font-size:13px;font-weight:400;font-style:italic}
.track span{font-size:12.5px;width:60px;text-align:right}
.track i{--h:11px;border-radius:0}
.track .d{background:#444}.track .r{background:repeating-linear-gradient(45deg,#111 0 2px,#fff 2px 4px);border:.75px solid #111}
.refs{font-size:12.5px;padding-left:22px}
.refs li{margin-bottom:3px;break-inside:avoid;text-align:left;overflow-wrap:anywhere}
.legal{font-size:12px;color:var(--soft);margin-top:20px}
@media (max-width:680px){.cols{columns:1}}
`, "family=STIX+Two+Text:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono", false) + `
<body><div class="page">
<div class="arx"><a href="/">omapocket.org</a><span>Preprint. Not peer reviewed. 2 Nov 2026.</span></div>
<h1>On the Equivalence of a $1,999 and a $94.99 Computer for the Purpose of Opening YouTube</h1>
<p class="authors">The Omarchy Pocket Contributors<small>Conflict of interest: the authors wrote the software on one of the two computers.</small></p>
<p class="abstract"><b>Abstract.</b> We compare the iPhone Duo with an Anbernic RG DS Plus running Omarchy Pocket. The first exceeds the second by a factor of ${x(GB.duo.s, GB.rg.s)} in single-core performance and of 12 in memory, and costs ${x(PRICE.duo, PRICE.rg)} as much. Both open YouTube, X and GitHub, join a tailnet, route through a VPN, and offer a keyboard on their lower half. We conclude that the iPhone Duo is the better computer in ${wins("duo")} of ${all.length} measures, that the two are equivalent in ${wins("tie")}, and that the RG DS Plus has a D-pad.</p>
<figure class="wide">${FIGURE(false)}<p class="cap"><b>Figure 1.</b> The subjects, open, to one scale. Left: iPhone Duo, 117.8 × 164.6 mm (illustration). Right: RG DS Plus, 167 × 181 mm (rendered from our model).</p></figure>
<div class="cols">
<h2>1. Introduction</h2>
<p>The folding pocket computer is an established form. Its recent examples place a keyboard on the lower half of the device and an application on the upper [1, 2]. Whether this arrangement requires a 2 nm process has not, to our knowledge, been studied.</p>
<h2>2. Materials</h2>
<p>Subject A is an iPhone Duo, released on 23 October 2026 at $1,999 [2, 4]. Subject B is an RG DS Plus, $94.99 at list [7], on which <a href="https://pocketjs.dev/">PocketJS</a> and Omarchy Pocket replace the desktop graphics stack. Neither manufacturer took part.</p>
<h2>3. Method</h2>
<p>For Subject B, we opened each application on the device and observed that it opened. For Subject A, we did not obtain a unit, and rely on published figures [1–4] and on the App Store. This is a limitation. The sample size is two, one of each, and no statistical test applies.</p>
<h2>4. Results</h2>
<p>Table 1 gives the measured differences. Subject A exceeds Subject B in every measure of performance, by margins that leave little to discuss.</p>
<p>In the tasks tested (YouTube, X, GitHub, Tailscale, a VPN, palmtop use, voice input on the device) we observed no difference in outcome. On Subject B, windows moved at 60 fps with 557 of 953 MB free. Subject A refreshes at up to 120 Hz. In points of Geekbench per frame per second, Subject B required 2.9 and Subject A 39.4, a metric we devised for this paper and do not defend.</p>
<p>Points per dollar favour Subject A, at ${(GB.duo.s / PRICE.duo).toFixed(2)} to ${(GB.rg.s / PRICE.rg).toFixed(2)}. We had hoped otherwise.</p>
<h2>5. Discussion</h2>
<p>For $1,999 one may purchase ${fleet} units of Subject B, with ${fleet * 4} cores, ${fleet * 2} screens and a mass of ${(fleet * 344 / 1000).toFixed(1)} kg. Their multi-core scores sum to ${(fleet * GB.rg.m).toLocaleString("en")}, which remains below that of one Subject A. Geekbench scores do not sum, and we report the figure regardless.</p>
<h2>6. Threats to validity</h2>
<p>The authors built the software on Subject B. They did not test Subject A. Subject B's Geekbench figures come from other RK3568 boards [5, 6]. YouTube was not asked for its opinion.</p>
<h2>7. Conclusion</h2>
<p>The iPhone Duo is the better computer. It has a camera, a modem and four times the battery life. Readers who do not need these may <a href="${BUY}" rel="sponsored noopener" target="_blank">obtain Subject B</a>.</p>
</div>
<figure class="wide"><div class="bars">${BARS}</div><p class="cap"><b>Figure 2.</b> Selected measures, each scaled to the larger value. Solid: Subject A. Hatched: Subject B.</p></figure>
<div class="tbl"><table><caption><b>Table 1.</b> Measures of the two subjects.</caption><thead><tr><th>Measure</th><th>Subject A</th><th>Subject B</th><th>Ratio</th></tr></thead><tbody>
${paperRows.map(([label, a, b, , note]) => `<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td><td>${note ?? ""}</td></tr>`).join("\n")}
<tr><th scope="row">Price</th><td>$1,999</td><td>$94.99</td><td>${x(PRICE.duo, PRICE.rg)}</td></tr>
</tbody></table></div>
<h2 style="font:700 15.5px/1.2 'STIX Two Text',serif;margin:18px 0 8px">References</h2>
<ol class="refs">${SOURCE_LIST}</ol>
<p class="legal">${LEGAL}</p>
</div></body>
</html>
`);
console.log("vs:", all.length, "lines;", wins("duo"), "duo,", wins("rg"), "rg,", wins("tie"), "same; fleet", fleet);
