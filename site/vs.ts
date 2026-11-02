// Builds /vs/iphone-duo from one table of figures, and the to-scale drawing of an
// iPhone Duo from Apple's published dimensions. The RG DS Plus beside it, its small
// copy and the D-pad close-up are stills rendered from the site's own 3D model.
//
//   bun site/vs.ts
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("public/vs/iphone-duo/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

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

// ---------- pieces ----------
const num = (n: number) => n.toLocaleString("en");
const LOCAL_NAV = `<a href="/#shapes">Interaction</a><a href="/#heart">Omarchy</a><a href="/#apps">Applets</a><a class="here" href="/vs/iphone-duo/" aria-current="page">vs iPhone Duo</a><a href="/demo/">Live demo</a><a href="https://github.com/pocket-nexus/omarchy-pocket">GitHub</a>`;
const DUO_IMG = (cls: string) => `<img class="${cls}" src="/vs/iphone-duo/iphone-duo.svg" width="1178" height="1646" alt="${cls === "lo" ? "An iPhone Duo, open: a keyboard and trackpad on the lower half of its one folding screen" : ""}" decoding="async">`;
const RG_IMG = (cls: string) => `<img class="${cls}" src="/vs/iphone-duo/rg-ds-plus.webp" width="1600" height="1724" alt="${cls === "lo" ? "An RG DS Plus, open, running Omarchy Pocket: YouTube on the upper screen, a keyboard and trackpad on the lower" : ""}" decoding="async">`;
const device = (who: "duo" | "rg", mm: string, name: string, facts: string) => `<figure class="dev ${who}">
  <div class="fold">${who === "duo" ? DUO_IMG("up") + DUO_IMG("lo") : RG_IMG("up") + RG_IMG("lo")}</div>
  <div class="rule"><i></i><span>${mm}</span></div>
  <figcaption><b>${name}</b><span>${facts}</span></figcaption>
</figure>`;
const pairBar = (label: string, duo: number, rg: number, duoText: string, rgText: string, cls = "") => {
  const top = Math.max(duo, rg);
  return `<div class="pb ${cls}"><div class="pb-h"><span>${label}</span></div>
  <div class="pb-r"><span class="who">iPhone Duo</span><span class="tr"><i class="d" style="--v:${((duo / top) * 100).toFixed(1)}"></i></span><b>${duoText}</b></div>
  <div class="pb-r"><span class="who">RG DS Plus</span><span class="tr"><i class="r" style="--v:${((rg / top) * 100).toFixed(1)}"></i></span><b>${rgText}</b></div></div>`;
};
const count = (value: number, text: string, dec = 0, pre = "", suf = "") => `<b class="n" data-count="${value}" data-dec="${dec}" data-pre="${pre}" data-suf="${suf}">${text}</b>`;
const dots = (n: number, cls: string) => n === 0 ? `<span class="none">none</span>` : Array.from({ length: n }, () => `<i class="${cls}"></i>`).join("");
const LACKS: [string, number, number][] = [["D-pad", 0, 1], ["Analog stick", 0, 1], ["Face and shoulder buttons", 0, 8], ["Screens you can see at once", 1, 2], ["microSD slots", 0, 2], ["Built-in stylus", 0, 1], ["Headphone jack", 0, 1]];
const COMMON: [label: string, colour: string, glyph: string][] = [
  ["YouTube", "#ff2d20", `<path fill="#fff" d="M9.5 7.5v9l7.5-4.5z"/>`],
  ["X", "#111", `<path fill="#fff" d="M17.6 4h2.6l-5.7 6.5L21.2 20H16l-4.1-5.4L7.2 20H4.6l6.1-7L4.3 4h5.3l3.7 4.9zm-.9 14.3h1.4L8.8 5.6H7.2z"/>`],
  ["GitHub", "#24292f", `<path fill="#fff" transform="translate(3.6 3.6) scale(.7)" d="M12 .3C5.4.3 0 5.7 0 12.3c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 22.1 24 17.6 24 12.3 24 5.7 18.6.3 12 .3z"/>`],
  ["Tailscale", "#2d2a33", [6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#fff" opacity="${y === 12 || (y === 18 && x === 12) ? 1 : 0.3}"/>`)).join("")],
  ["A VPN", "#2f6df6", `<path fill="#fff" d="M12 3.5l7 2.6v5.2c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6.1z"/><path fill="none" stroke="#2f6df6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8.8 11.9l2.3 2.3 4.2-4.4"/>`],
  ["Lower-half keyboard", "#6e6e73", `<rect x="3.5" y="6.5" width="17" height="11" rx="2.4" fill="#fff"/><path stroke="#6e6e73" stroke-width="1.5" stroke-linecap="round" d="M6.8 10h.01M10.3 10h.01M13.8 10h.01M17.2 10h.01M8.5 14.3h7"/>`],
  ["Voice input", "#8a4dff", `<rect x="9" y="3.6" width="6" height="11" rx="3" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3"/>`],
];
const icons = COMMON.map(([label, colour, glyph], i) => `<li class="it" style="--i:${i}"><span class="ic" style="background:${colour}"><svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg></span><span class="lb">${label}</span></li>${i === 2 ? '<li class="br m" aria-hidden="true"></li>' : ""}${i === 1 || i === 4 ? '<li class="br d" aria-hidden="true"></li>' : ""}`).join("");
const fleetCells = Array.from({ length: fleet }, () => `<img src="/vs/iphone-duo/rg-mini.webp" width="220" height="237" alt="" decoding="async">`).join("");
const compare = ROWS.map((g) => `<tbody><tr class="group"><th colspan="3" scope="colgroup">${g.title}</th></tr>
${g.rows.map(([label, duo, rg, w, note]) => `<tr><th scope="row">${label}${note ? `<small>${note}</small>` : ""}</th><td class="${w === "duo" ? "win" : ""}">${duo}</td><td class="${w === "rg" ? "win" : ""}">${rg}</td></tr>`).join("\n")}
</tbody>`).join("\n");
const SOURCE_LIST = SOURCES.map(([t, u]) => `<li><a href="${u}"${u === BUY ? ' rel="sponsored noopener"' : ""}>${t}</a></li>`).join("\n");

// ---------- style ----------
const STYLE = `
:root{--bg:#f5f5f7;--tile:#fff;--ink:#1d1d1f;--soft:#6e6e73;--faint:#86868b;--line:#d2d2d7;--duo:#8e8e93;--rg:#f0663c;--grad:linear-gradient(96deg,#7c4dff,#e8467c 48%,#f59a23);--night:linear-gradient(155deg,#231033,#3a1946 58%,#5c2245);--g:clamp(16px,4vw,40px);--nav:52px;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",Inter,system-ui,sans-serif}
*{box-sizing:border-box;margin:0}
html{background:var(--bg);color-scheme:light;-webkit-text-size-adjust:100%}
body{color:var(--ink);font:17px/1.47 var(--sans);letter-spacing:-.012em;overflow-x:clip;-webkit-font-smoothing:antialiased}
a{color:inherit}
img,video,svg{display:block}
h1,h2,h3{font-weight:700;letter-spacing:-.032em;text-wrap:balance}
.g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
sup{font-size:.6em;line-height:0;font-weight:500;letter-spacing:0}

/* the local nav */
.local{position:sticky;top:0;z-index:30;height:var(--nav);margin-bottom:calc(-1*var(--nav));display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 var(--g);background:rgba(245,245,247,.78);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(0,0,0,.08);font-size:13.5px}
.local a{text-decoration:none}
.logo{display:flex;gap:9px;align-items:center;font-weight:600;font-size:16px;white-space:nowrap}
.logo i{width:13px;height:19px;border-radius:3px;border:2px solid currentColor;display:block;position:relative}
.logo i::after{content:"";position:absolute;left:-2px;right:-2px;top:6px;height:2px;background:currentColor}
.right{display:flex;align-items:center;gap:20px}
.local nav{display:flex;align-items:center;gap:20px;color:#424245}
.local nav a:hover,.local nav .here{color:var(--ink)}
.local nav .here{font-weight:600}
.buy{padding:6px 13px;border-radius:999px;background:var(--ink);color:#fff;font-weight:500;white-space:nowrap}
.burger{display:none;flex-direction:column;justify-content:center;gap:6px;width:40px;height:40px;margin-right:-9px;padding:0 9px;border:0;background:none;color:inherit;cursor:pointer}
.burger i{display:block;height:1.6px;border-radius:1px;background:currentColor;transition:transform .18s}
.local.open .burger i:first-child{transform:translateY(3.8px) rotate(45deg)}
.local.open .burger i:last-child{transform:translateY(-3.8px) rotate(-45deg)}
@media (max-width:860px){
  .right{gap:8px}
  .burger{display:flex}
  .local nav{position:absolute;left:10px;right:10px;top:calc(100% + 6px);flex-direction:column;align-items:stretch;gap:0;padding:6px;background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.18);font-size:17px;opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .18s,transform .18s,visibility .18s}
  .local.open nav{opacity:1;visibility:visible;transform:none}
  .local nav a{padding:14px}
  .local nav a+a{border-top:1px solid #e8e8ed}
}

/* pinned stages */
.pin{position:relative}
.stick{position:sticky;top:0;height:100svh;padding-top:var(--nav);overflow:clip;display:flex;flex-direction:column;align-items:center;justify-content:center}
@media (min-height:561px){.pin.long{height:210svh}.pin.mid{height:170svh}}
@media (max-height:560px){.stick{position:static;height:auto;padding:calc(var(--nav) + 24px) 0 40px}}

/* the hero */
.hero .stick{--gap:clamp(14px,4vw,64px);--copy:clamp(150px,27svh,250px);--mm:min(calc((100vw - 2*var(--g) - var(--gap))/284.8),calc((100svh - var(--nav) - var(--copy) - 106px)/181));justify-content:flex-start;text-align:center}
.hero-copy{height:var(--copy);display:flex;flex-direction:column;justify-content:center;padding:0 var(--g);will-change:transform,opacity}
.eyebrow{font-size:clamp(14px,1.4vw,17px);font-weight:600;color:var(--soft)}
h1{margin-top:4px;font-size:clamp(38px,7vw,88px);line-height:1.03}
.sub{margin-top:6px;font-size:clamp(19px,2.2vw,28px);font-weight:600;letter-spacing:-.022em;color:var(--soft)}
.pair{display:flex;align-items:flex-end;justify-content:center;gap:var(--gap);text-align:left;will-change:transform}
.dev{min-width:0}
.fold{position:relative;perspective:calc(var(--mm)*380);perspective-origin:50% 30%}
.duo{width:calc(var(--mm)*117.8)}
.rg{width:calc(var(--mm)*167)}
.fold img{width:100%;height:auto}
.fold .lo{clip-path:inset(50% 0 0 0)}
.fold .up{position:absolute;inset:0;clip-path:inset(0 0 49.9% 0);transform-origin:50% 50%;backface-visibility:hidden}
.js .fold .up{transform:rotateX(-84deg);filter:brightness(.55);transition:transform 1.7s cubic-bezier(.2,.75,.2,1),filter 1.7s}
.js .rg .up{transition-delay:.14s}
.js.opened .fold .up{transform:none;filter:none}
.rule{position:relative;height:22px;margin-top:10px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--soft);font-variant-numeric:tabular-nums}
.rule i{position:absolute;left:0;right:0;top:50%;height:1px;background:var(--faint)}
.rule i::before,.rule i::after{content:"";position:absolute;top:-4px;height:9px;width:1px;background:var(--faint)}
.rule i::after{right:0}
.rule span{position:relative;padding:0 7px;background:var(--bg)}
.js .rule i{transform:scaleX(0);transition:transform 1.2s .7s cubic-bezier(.2,.75,.2,1)}
.js.opened .rule i{transform:none}
.dev figcaption{margin-top:6px;text-align:center;font-size:clamp(12px,1.25vw,15px);line-height:1.3}
.dev figcaption b{display:block;font-weight:600}
.dev figcaption span{color:var(--soft)}

/* sections */
.sec{max-width:1160px;margin:0 auto;padding:clamp(56px,9vw,112px) var(--g) 0}
.sec-h{font-size:clamp(34px,5.6vw,64px);line-height:1.05}
.sec-p{margin-top:12px;max-width:40rem;font-size:clamp(17px,1.8vw,21px);line-height:1.35;color:var(--soft);text-wrap:pretty}
.js .rise{opacity:0;transform:translateY(26px) scale(.985);transition:opacity .8s cubic-bezier(.2,.75,.2,1),transform .9s cubic-bezier(.2,.75,.2,1)}
.js .rise.in{opacity:1;transform:none}

/* the bento */
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:clamp(10px,1.3vw,16px);margin-top:clamp(24px,3vw,40px)}
.t{grid-column:span 12;min-width:0;padding:clamp(18px,2.2vw,30px);border-radius:clamp(20px,2vw,28px);background:var(--tile);display:flex;flex-direction:column;overflow:hidden}
.c7{grid-column:span 7}.c6{grid-column:span 6}.c5{grid-column:span 5}.c4{grid-column:span 4}
.r2{grid-row:span 2}
.t h3{font-size:clamp(14px,1.3vw,17px);font-weight:600;letter-spacing:-.016em}
.t p{font-size:clamp(14px,1.3vw,17px);line-height:1.32;color:var(--soft);text-wrap:pretty}
.big{display:block;margin:2px 0 4px;font-size:clamp(50px,7.2vw,92px);font-weight:700;line-height:1;letter-spacing:-.045em;font-variant-numeric:tabular-nums}
.big.m{font-size:clamp(40px,4.8vw,62px)}
.n{font-weight:inherit}
.fill{flex:1;min-height:12px}

.pb{margin-top:18px}
.pb-h{font-size:13px;font-weight:600;margin-bottom:6px}
.pb-r{display:grid;grid-template-columns:78px minmax(0,1fr) 54px;gap:8px;align-items:center;margin-top:6px;font-size:13px;font-variant-numeric:tabular-nums}
.pb-r .who{color:var(--soft)}
.pb-r b{text-align:right;font-weight:600}
.tr{display:block;height:clamp(10px,1.1vw,14px)}
.tr i{display:block;height:100%;width:max(calc(var(--v)*1%),2px);border-radius:99px;transform-origin:left}
.tr .d{background:var(--duo)}.tr .r{background:var(--rg)}
.js .tr i{transform:scaleX(0);transition:transform 1.3s .15s cubic-bezier(.2,.75,.2,1)}
.js .in .tr i{transform:none}

.flat{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;height:100%}
.flat>div:first-child{min-width:0}
.flat p{margin-top:2px}
.thick .tr{height:clamp(18px,2.4vw,30px)}
.thick .pb{margin-top:22px}
.thick .pb-r{grid-template-columns:78px minmax(0,1fr) 58px;margin-top:8px}
.chips{display:flex;flex:none;gap:clamp(12px,1.4vw,18px)}
.chips>div{min-width:0}
.chipgrid{display:grid;grid-template-columns:repeat(4,clamp(14px,1.5vw,20px));gap:3px;min-height:calc(clamp(14px,1.5vw,20px)*3 + 6px);align-content:end}
.chipgrid i{display:block;aspect-ratio:1;border-radius:4px;background:var(--duo)}
.chipgrid .o{background:var(--rg)}
.chips small{display:block;margin-top:7px;font-size:11.5px;line-height:1.2;color:var(--soft)}
.chips>div:last-child .chipgrid{grid-template-columns:clamp(14px,1.5vw,20px)}
.js .chipgrid i{opacity:0;transform:scale(.5);transition:opacity .35s,transform .45s cubic-bezier(.2,1.3,.4,1);transition-delay:calc(var(--k)*50ms + .2s)}
.js .in .chipgrid i{opacity:1;transform:none}

.night{background:var(--night);color:#fff}
.night p,.night .soft{color:#d6c6dc}
.area{display:flex;flex:none;align-items:flex-end;gap:12px}
.area i{display:block;border-radius:6px;transform-origin:left bottom}
.area .a{width:clamp(72px,7vw,96px);aspect-ratio:1;background:rgba(255,255,255,.2)}
.area .b{width:calc(clamp(72px,7vw,96px)/4.59);aspect-ratio:1;background:#ffb05f}
.area small{display:block;margin-top:6px;font-size:12px;color:#d6c6dc}
.js .area i{transform:scale(0);transition:transform 1s .2s cubic-bezier(.2,.75,.2,1)}
.js .in .area i{transform:none}

.tick{margin-top:14px;display:grid;gap:10px}
.tick>div{font-size:12px;color:var(--soft)}
.lane{position:relative;height:12px;margin-top:4px;border-radius:99px;background:#efeff2;overflow:hidden}
.mover{position:absolute;left:0;top:0;bottom:0;width:calc(100% - 12px);animation:move 2s infinite alternate}
.mover i{display:block;width:12px;height:12px;border-radius:50%}
.mover.f{animation-timing-function:steps(48)}.mover.s{animation-timing-function:steps(24)}
.mover.f i{background:var(--duo)}.mover.s i{background:var(--rg)}
@keyframes move{to{transform:translateX(100%)}}

.batt{display:grid;gap:10px;margin-top:14px;font-size:12px;color:var(--soft)}
.cell{position:relative;height:clamp(18px,2vw,24px);margin-top:4px;margin-right:4px;padding:2px;border:1.5px solid var(--faint);border-radius:6px}
.cell::after{content:"";position:absolute;right:-5px;top:50%;width:3px;height:8px;margin-top:-4px;border-radius:0 2px 2px 0;background:var(--faint)}
.cell i{display:block;height:100%;width:calc(var(--v)*1%);border-radius:3px;transform-origin:left}
.js .cell i{transform:scaleX(0);transition:transform 1.5s .2s cubic-bezier(.2,.75,.2,1)}
.js .in .cell i{transform:none}

.scale{width:100%;max-width:260px;margin-top:12px;overflow:visible}
.scale text{font:600 11px var(--sans);text-anchor:middle;fill:var(--ink)}
.beam,.panl,.panr{transition:transform 1.4s .25s cubic-bezier(.3,1.5,.5,1)}
.beam{transform-origin:120px 22px;transform:rotate(4.8deg)}
.panl{transform:translateY(-7.5px)}.panr{transform:translateY(7.5px)}
.js .t:not(.in) .beam{transform:none}
.js .t:not(.in) .panl,.js .t:not(.in) .panr{transform:none}

.lacks{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;column-gap:clamp(10px,2vw,22px);margin-top:14px;font-size:clamp(13px,1.2vw,15px)}
.lacks>*{padding:7px 0;border-bottom:1px solid #eeeef1}
.lacks .h{font-size:12px;font-weight:600;color:var(--soft);padding-top:0}
.lacks .v{display:flex;gap:3px;min-width:clamp(42px,8vw,108px);min-height:100%;align-items:center}
.lacks .v i{display:block;width:10px;height:10px;border-radius:50%}
.lacks .v .d{background:var(--duo)}.lacks .v .r{background:var(--rg)}
.lacks .none{color:var(--faint);font-size:12px}
.lacks>:nth-last-child(-n+3){border-bottom:0}
.js .lacks .v i{transform:scale(0);transition:transform .4s cubic-bezier(.2,1.5,.4,1) .4s}
.js .in .lacks .v i{transform:none}

/* both */
.both .stick{--w:min(92vw,1040px,calc((100svh - var(--nav) - 190px)/.62));--sx:.16;--sy:0;padding-left:var(--g);padding-right:var(--g);text-align:center}
.both h2{font-size:clamp(32px,5vw,60px);line-height:1.05}
.venn{--e:1;position:relative;width:var(--w);height:calc(var(--w)*.62);margin-top:clamp(10px,2vh,22px);flex:none}
.disc{position:absolute;top:.01em;width:calc(var(--w)*.6);height:calc(var(--w)*.6);border-radius:50%;will-change:transform}
.disc.a{left:calc(var(--w)*.05);background:radial-gradient(circle at 35% 35%,rgba(142,142,147,.3),rgba(142,142,147,.2));transform:translate(calc((var(--e) - 1)*var(--w)*var(--sx)),calc((var(--e) - 1)*var(--w)*var(--sy)))}
.disc.b{left:calc(var(--w)*.35);background:radial-gradient(circle at 65% 65%,rgba(245,134,50,.34),rgba(240,102,60,.22));transform:translate(calc((1 - var(--e))*var(--w)*var(--sx)),calc((1 - var(--e))*var(--w)*var(--sy)))}
.only{position:absolute;top:50%;width:calc(var(--w)*.2);margin-top:calc(var(--w)*-.12);font-size:clamp(11.5px,calc(var(--w)*.0155),16px);line-height:1.36;color:#424245;text-align:center}
.only h3{margin-bottom:6px;font-size:1.02em;font-weight:600;letter-spacing:-.012em;color:var(--ink)}
.only ul{list-style:none;padding:0}
.only.a{left:calc(var(--w)*.105);transform:translate(calc((var(--e) - 1)*var(--w)*var(--sx)),calc((var(--e) - 1)*var(--w)*var(--sy)))}
.only.b{right:calc(var(--w)*.105);transform:translate(calc((1 - var(--e))*var(--w)*var(--sx)),calc((1 - var(--e))*var(--w)*var(--sy)))}
.common{position:absolute;left:50%;top:50%;width:calc(var(--w)*.31);transform:translate(-50%,-50%);display:flex;flex-wrap:wrap;justify-content:center;row-gap:calc(var(--w)*.016);padding:0;list-style:none}
.br{flex-basis:100%;height:0}
.br.m{display:none}
.it{--t:1;width:calc(var(--w)*.1);display:flex;flex-direction:column;align-items:center;gap:calc(var(--w)*.006);opacity:var(--t);transform:scale(calc(.55 + .45*var(--t))) translateY(calc((1 - var(--t))*14px))}
.ic{width:calc(var(--w)*.06);height:calc(var(--w)*.06);border-radius:23%;box-shadow:0 4px 14px rgba(0,0,0,.14)}
.ic svg{width:100%;height:100%}
.lb{font-size:clamp(10.5px,calc(var(--w)*.0135),14px);line-height:1.15;font-weight:500}
.both-note{margin-top:clamp(8px,1.6vh,18px);max-width:34rem;font-size:clamp(14px,1.5vw,18px);line-height:1.32;color:var(--soft);text-wrap:balance}
@media (max-width:700px){
  .both .stick{--w:min(calc(100vw - 8px),calc((100svh - var(--nav) - 178px)/1.5));--sx:0;--sy:.28;padding-left:0;padding-right:0}
  .venn{height:calc(var(--w)*1.5)}
  .disc{width:calc(var(--w)*1.06);height:calc(var(--w)*1.06);top:0;left:calc(var(--w)*-.03)}
  .disc.a{top:0;left:calc(var(--w)*-.03)}
  .disc.b{top:calc(var(--w)*.44);left:calc(var(--w)*-.03)}
  .only{left:calc(var(--w)*.14)!important;right:auto!important;width:calc(var(--w)*.72);margin-top:0;font-size:12.5px;transform:none!important}
  .only.a{top:calc(var(--w)*.075)}
  .only.b{top:calc(var(--w)*1.1)}
  .only h3{margin-bottom:2px}
  .only ul{display:flex;flex-wrap:wrap;justify-content:center;gap:0 9px}
  .common{top:calc(var(--w)*.75);width:calc(var(--w)*.94);row-gap:calc(var(--w)*.03)}
  .br.m{display:block}.br.d{display:none}
  .it{width:calc(var(--w)*.222);gap:4px}
  .ic{width:calc(var(--w)*.128);height:calc(var(--w)*.128)}
  .both-note{padding:0 var(--g)}
}
@media (max-height:560px) and (min-width:701px){.both .stick{--w:min(92vw,700px)}}

/* smoothness */
.smooth{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:clamp(20px,4vw,60px);align-items:center;padding:clamp(24px,5vw,64px);border-radius:clamp(22px,2.4vw,34px);background:var(--night);color:#fff}
.smooth .eyebrow{color:#ffb97a}
.smooth h2{margin-top:6px;font-size:clamp(34px,5vw,60px);line-height:1.04}
.smooth p{margin-top:14px;font-size:clamp(16px,1.6vw,19px);line-height:1.36;color:#e3d6e6;text-wrap:pretty}
.smooth a{color:#fff}
.stats4{display:grid;grid-template-columns:repeat(4,auto);justify-content:space-between;gap:12px;margin-top:22px}
.stats4 b{display:block;font-size:clamp(26px,3.2vw,40px);line-height:1.05;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.stats4 span{display:block;margin-top:2px;font-size:12.5px;line-height:1.2;color:#cfbfd6}
.smooth .pb-r .who,.smooth .pb-h{color:#e3d6e6}
.smooth .tr .d{background:rgba(255,255,255,.42)}.smooth .tr .r{background:#ffb05f}
.smooth .fine{margin-top:8px;font-size:12px;color:#bda9c6}
.screen{justify-self:center;width:min(100%,380px);aspect-ratio:2/3;border-radius:16px;overflow:hidden;background:#000;box-shadow:0 30px 70px rgba(0,0,0,.4),0 0 0 7px #0c0c0f,0 0 0 8px rgba(255,255,255,.14)}
.screen video{width:100%;height:100%;object-fit:cover}
@media (max-width:760px){.smooth{grid-template-columns:1fr}.stats4{grid-template-columns:repeat(2,1fr)}.screen{width:min(100%,300px);margin-top:8px}}

/* the fleet */
.fleet .stick{--c:min(calc((100vw - 2*var(--g) - 88px)/7.7),calc((100svh - var(--nav) - 340px)/3.3),92px);padding-left:var(--g);padding-right:var(--g)}
.fleet-in{width:min(100%,1000px);text-align:center}
.fleet h2{font-size:clamp(32px,5vw,60px);line-height:1.05}
.lot{display:flex;align-items:flex-end;justify-content:center;gap:clamp(16px,3vw,44px);margin-top:clamp(12px,2.4vh,26px)}
.lot .one{flex:none;width:calc(var(--c)*.705)}
.lot .one img{width:100%;height:auto}
.lot small{display:block;margin-top:5px;font-size:11.5px;line-height:1.15;color:var(--soft);white-space:nowrap}
.lot .one small{width:max-content;transform:translateX(calc((var(--c)*.705 - 100%)/2))}
.herd{display:grid;grid-template-columns:repeat(7,var(--c));gap:clamp(4px,.7vw,8px)}
.herd img{width:100%;height:auto}
.js .herd img{opacity:0;transform:translateY(10px) scale(.8);transition:opacity .28s,transform .4s cubic-bezier(.2,1.4,.4,1)}
.js .herd img.on{opacity:1;transform:none}
.tally{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:clamp(12px,2.4vh,26px)}
.tally b{display:block;font-size:clamp(22px,3.4vw,42px);line-height:1.05;letter-spacing:-.035em;font-variant-numeric:tabular-nums;white-space:nowrap}
.tally span{display:block;margin-top:2px;font-size:clamp(11px,1.1vw,13px);line-height:1.2;color:var(--soft)}
.race{position:relative;margin-top:clamp(12px,2.4vh,24px);text-align:left}
.race-t{position:relative;height:clamp(14px,2vh,20px);border-radius:99px;background:#e8e8ed;overflow:hidden}
.race-f{position:absolute;left:0;top:0;bottom:0;width:calc(var(--n,21)*495/12708*100%);background:repeating-linear-gradient(90deg,var(--rg) 0 calc(100%/var(--n,21) - 1.5px),#e8e8ed 0 calc(100%/var(--n,21)));transition:width .3s cubic-bezier(.2,.75,.2,1)}
.race-l{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:clamp(12px,1.2vw,14px);line-height:1.25;color:var(--soft)}
.race-l b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
@media (max-width:560px){.tally{grid-template-columns:repeat(4,1fr)}.tally .sp{grid-column:1/-1;display:flex;align-items:baseline;justify-content:center;gap:8px}.fleet .stick{--c:min(calc((100vw - 2*var(--g) - 70px)/7.7),calc((100svh - var(--nav) - 370px)/3.3))}}

/* compare */
.score{display:flex;gap:3px;height:clamp(40px,5vw,54px);margin-top:20px;font-size:clamp(12px,1.25vw,15px);font-weight:600;color:#fff}
.score div{display:flex;align-items:center;justify-content:center;flex:var(--v);min-width:0;padding:0 6px;text-align:center;line-height:1.1;transform-origin:left}
.score div:first-child{background:var(--duo);border-radius:14px 3px 3px 14px}
.score div:nth-child(2){background:var(--rg)}
.score div:last-child{background:#c7c7cc;color:var(--ink);border-radius:3px 14px 14px 3px}
.js .score div{transform:scaleX(0);transition:transform .9s cubic-bezier(.2,.75,.2,1)}
.js .score div:nth-child(2){transition-delay:.2s}.js .score div:last-child{transition-delay:.4s}
.js .in .score div,.js .score.in div{transform:none}
table{width:100%;margin-top:26px;border-collapse:collapse;font-size:clamp(14px,1.35vw,17px)}
thead th{position:sticky;top:var(--nav);z-index:3;padding:10px 12px 10px 0;background:var(--bg);border-bottom:1px solid var(--line);text-align:left;font-size:13.5px;font-weight:600}
thead .ph{display:flex;align-items:center;gap:9px}
thead img{height:40px;width:auto}
tbody th,td{padding:11px 12px 11px 0;border-bottom:1px solid #e3e3e8;text-align:left;font-weight:400;vertical-align:baseline}
tbody tr>th[scope=row]{width:44%}
tbody small{margin-left:8px;font-size:.82em;color:var(--faint);white-space:nowrap}
td{width:28%;font-variant-numeric:tabular-nums}
td.win{font-weight:600}
td.win::before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--rg);vertical-align:.1em}
td.win:nth-of-type(1)::before{background:var(--duo)}
.group th{padding-top:30px;padding-bottom:8px;font-size:clamp(20px,2.2vw,28px);font-weight:700;letter-spacing:-.025em;border-bottom:1px solid var(--line)}
@media (max-width:640px){
  table,thead,tbody{display:block}
  thead tr,tbody tr{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}
  thead th:first-child{display:none}
  thead th{top:var(--nav)}
  tbody tr>th[scope=row]{grid-column:1/-1;width:auto;padding:12px 0 0;border:0;color:var(--soft);font-size:13px}
  td{width:auto;padding:2px 0 12px}
  .group th{grid-column:1/-1}
  tbody small{float:right}
}

/* the close */
.close{position:relative;margin-top:clamp(56px,9vw,112px);overflow:hidden;background:var(--night);color:#fff;text-align:center}
.close-in{position:relative;z-index:2;padding:clamp(64px,10vw,130px) var(--g) clamp(14px,3vw,30px)}
.close h2{font-size:clamp(36px,6.6vw,84px);line-height:1.03}
.close .then{margin-top:12px;font-size:clamp(26px,3.8vw,48px);font-weight:700;letter-spacing:-.03em}
.ctas{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:24px}
.cta{display:inline-block;padding:13px 22px;border-radius:999px;background:#fff;color:var(--ink);font-weight:600;text-decoration:none}
.cta.alt{background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.45);color:#fff}
.dpad{width:min(100%,1500px);height:auto;margin:clamp(-20px,-2vw,0px) auto 0;will-change:transform;transform:translateY(calc((1 - var(--p,1))*70px)) scale(calc(1.14 - .14*var(--p,1)));transform-origin:30% 60%}

/* the fine print */
.fine-print{max-width:1160px;margin:0 auto;padding:30px var(--g) 48px;font-size:12px;line-height:1.45;color:var(--soft)}
.fine-print ol{padding-left:18px}
.fine-print li+li{margin-top:5px}
.fine-print h3{margin:18px 0 6px;font-size:12px;font-weight:600;letter-spacing:0}
.fine-print a{text-underline-offset:2px}

@media (max-width:760px){
  .bento .c7,.bento .c5,.bento .c6{grid-column:span 12}
  .bento .c4{grid-column:span 6}
  .bento .c4.w{grid-column:span 12}
  .r2{grid-row:auto}
  .pb-r{grid-template-columns:70px minmax(0,1fr) 50px}
}
/* too short to pin: the stages sit in the flow and size from the width */
@media (max-height:560px),(max-height:640px) and (max-width:700px){
  .pin.long,.pin.mid{height:auto}
  .stick{position:static;height:auto;padding:calc(var(--nav) + 24px) 0 40px}
  .hero .stick{--copy:auto;--mm:min(calc((100vw - 2*var(--g) - var(--gap))/284.8),1.9px)}
  .hero-copy{padding-bottom:18px}
  .fleet .stick{--c:min(calc((100vw - 2*var(--g) - 70px)/7.7),58px);padding-left:var(--g);padding-right:var(--g)}
}
@media (max-height:640px) and (max-width:700px){.both .stick{--w:calc(100vw - 8px)}}
@media (prefers-reduced-motion:reduce){
  .js .fold .up,.js .rise,.js .tr i,.js .chipgrid i,.js .area i,.js .cell i,.js .lacks .v i,.js .herd img,.js .score div,.js .rule i{transform:none!important;opacity:1!important;filter:none!important;transition:none!important}
  .mover{animation:none}
  .pin.long,.pin.mid{height:auto}
  .stick{position:static;height:auto;min-height:100svh}
}
`;

// ---------- behaviour ----------
const SCRIPT = `
(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // the menu
  const bar = $(".local"), burger = $(".burger");
  const setMenu = (open) => { bar.classList.toggle("open", open); burger.setAttribute("aria-expanded", String(open)); };
  document.addEventListener("click", (e) => {
    if (e.target.closest(".burger")) setMenu(!bar.classList.contains("open"));
    else if (!e.target.closest(".local nav") || e.target.closest("a")) setMenu(false);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  // the devices open once the page has its images
  const lids = $$(".fold img");
  Promise.race([Promise.all(lids.map((i) => i.decode?.().catch(() => {}))), new Promise((r) => setTimeout(r, 1200))])
    .then(() => requestAnimationFrame(() => setTimeout(() => root.classList.add("opened"), 150)));

  // numbers count up as they arrive
  const fmt = (el, v) => el.dataset.pre + (+v.toFixed(+el.dataset.dec)).toLocaleString("en", { minimumFractionDigits: +el.dataset.dec, maximumFractionDigits: +el.dataset.dec }) + el.dataset.suf;
  const countUp = (el) => {
    if (reduced) return;
    const to = +el.dataset.count, t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / 1100);
      el.textContent = fmt(el, to * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const seen = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      e.target.classList.add("in");
      $$("[data-count]", e.target).forEach(countUp);
    }
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
  $$(".rise").forEach((el) => seen.observe(el));

  // the video runs while it is on screen
  const video = $("video");
  if (video) new IntersectionObserver(([e]) => { e.isIntersecting && !reduced ? video.play().catch(() => {}) : video.pause(); }, { threshold: 0.2 }).observe(video);

  // stages pinned to the scroll
  const hero = $(".hero"), copy = $(".hero-copy"), pair = $(".pair");
  const both = $(".both"), venn = $(".venn"), its = $$(".it"), onlys = $$(".only");
  const fleet = $(".fleet"), herd = $$(".herd img");
  const dpad = $(".dpad"), closeEl = $(".close");
  const texts = {
    cost: $("#f-cost"), left: $("#f-left"), cores: $("#f-cores"), gb: $("#f-gb"), screens: $("#f-screens"), kg: $("#f-kg"), sum: $("#f-sum"), race: $(".race-f"),
  };
  let m = {}, last = -1;
  const pinOf = (el) => {
    const stick = $(".stick", el), len = el.offsetHeight - stick.offsetHeight;
    return { top: el.offsetTop, len };
  };
  const measure = () => {
    m.hero = pinOf(hero); m.both = pinOf(both); m.fleet = pinOf(fleet);
    m.pair = { top: pair.offsetTop, w: pair.offsetWidth, h: pair.offsetHeight };
    m.stickH = $(".stick", hero).offsetHeight;
    m.vw = innerWidth; m.nav = 52;
    m.scale = Math.min((m.vw - 32) / m.pair.w, (m.stickH - m.nav - 20) / m.pair.h, 1.6);
    m.dy = m.nav + (m.stickH - m.nav) / 2 - (m.pair.top + m.pair.h / 2);
    last = -1;
  };
  const prog = (pin, y) => pin.len > 20 && !reduced ? clamp((y - pin.top) / pin.len) : 1;
  const setHerd = (n) => {
    if (n === setHerd.n) return;
    setHerd.n = n;
    herd.forEach((img, i) => img.classList.toggle("on", i < n));
    texts.cost.textContent = "$" + (n * ${PRICE.rg}).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    texts.left.textContent = "$" + (${PRICE.duo} - n * ${PRICE.rg}).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " left";
    texts.cores.textContent = n * 4;
    texts.gb.textContent = n + " GB";
    texts.screens.textContent = n * 2;
    texts.kg.textContent = (n * 0.344).toFixed(1) + " kg";
    texts.sum.textContent = (n * ${GB.rg.m}).toLocaleString("en");
    texts.race.style.setProperty("--n", n);
  };
  const update = () => {
    const y = scrollY;
    if (y === last) return;
    last = y;
    // the hero
    const h = reduced ? 0 : (m.hero.len > 20 ? clamp((y - m.hero.top) / m.hero.len) : 0);
    const he = smooth(h);
    copy.style.opacity = 1 - clamp(h / 0.55);
    copy.style.transform = "translateY(" + (-46 * he).toFixed(1) + "px)";
    pair.style.transform = "translateY(" + (m.dy * he).toFixed(1) + "px) scale(" + (1 + (m.scale - 1) * he).toFixed(4) + ")";
    // the two circles
    const b = prog(m.both, y);
    venn.style.setProperty("--e", smooth(clamp(b / 0.42)).toFixed(4));
    its.forEach((it, i) => it.style.setProperty("--t", smooth(clamp((b - 0.4 - i * 0.055) / 0.14)).toFixed(3)));
    // twenty-one of them
    const f = prog(m.fleet, y);
    setHerd(Math.max(1, Math.ceil(clamp(f / 0.92) * ${fleet})));
    // the D-pad
    const c = closeEl.getBoundingClientRect();
    dpad.style.setProperty("--p", reduced ? 1 : clamp((innerHeight - c.top) / (c.height + 40)).toFixed(4));
  };
  measure();
  update();
  let ticking = false;
  addEventListener("scroll", () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); }, { passive: true });
  let lastW = innerWidth;
  addEventListener("resize", () => { if (innerWidth === lastW) return; lastW = innerWidth; measure(); update(); });
  addEventListener("load", () => { measure(); update(); });
  document.fonts?.ready.then(() => { measure(); update(); });
})();
`;

// ---------- the page ----------
const chipCells = (n: number, cls = "") => Array.from({ length: n }, (_, k) => `<i class="${cls}" style="--k:${k}"></i>`).join("");
const TITLE = "iPhone Duo vs Omarchy Pocket";
const DESCRIPTION = `A comparison of a $1,999 foldable and a $94.99 handheld. The iPhone Duo is ${x(GB.duo.s, GB.rg.s)} faster. Both open YouTube.`;
writeFileSync(`${OUT}index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="https://omapocket.org/vs/iphone-duo/">
<meta name="theme-color" content="#f5f5f7">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Omarchy Pocket">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="https://omapocket.org/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<script>document.documentElement.classList.add("js")</script>
<style>${STYLE}</style>
</head>
<body>
<header class="local">
  <a class="logo" href="/"><i></i>Omarchy Pocket</a>
  <div class="right">
    <nav id="menu">${LOCAL_NAV}</nav>
    <a class="buy" href="${BUY}" rel="sponsored noopener" target="_blank">Buy</a>
    <button class="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu"><i></i><i></i></button>
  </div>
</header>

<section class="hero pin mid">
  <div class="stick">
    <div class="hero-copy">
      <p class="eyebrow">iPhone Duo vs Omarchy Pocket</p>
      <h1>Two folding computers.</h1>
      <p class="sub">One of them is an iPhone.</p>
    </div>
    <div class="pair">
      ${device("duo", "117.8 mm", "iPhone Duo", "254 g · $1,999")}
      ${device("rg", "167 mm", "RG DS Plus with Omarchy Pocket", "344 g · $94.99")}
    </div>
  </div>
</section>

<section class="sec">
  <h2 class="sec-h rise">The differences are large.</h2>
  <p class="sec-p rise">We compared them on ${all.length} lines. The iPhone Duo wins ${wins("duo")}, including all of the ones you would check first.</p>
  <div class="bento">
    <article class="t c7 r2 thick rise">
      <h3>Geekbench 6, single core<sup>1</sup></h3>
      <span class="big g">${count(GB.duo.s / GB.rg.s, x(GB.duo.s, GB.rg.s), 1, "", "×")}</span>
      <p>The iPhone Duo uses a 2 nm A20 Pro with six cores. The RG DS Plus uses a 22 nm RK3568 with four Cortex-A55 cores, a design from 2017.</p>
      <div class="fill"></div>
      ${pairBar("Single core", GB.duo.s, GB.rg.s, num(GB.duo.s), num(GB.rg.s))}
      ${pairBar(`Multi core, ${x(GB.duo.m, GB.rg.m)}`, GB.duo.m, GB.rg.m, num(GB.duo.m), num(GB.rg.m))}
    </article>
    <article class="t c5 rise">
      <div class="flat"><div><h3>Memory</h3>
      <span class="big m">${count(12, "12×", 0, "", "×")}</span>
      <p>12 GB to 1 GB.</p></div>
      <div class="chips">
        <div><div class="chipgrid">${chipCells(12)}</div><small>iPhone Duo</small></div>
        <div><div class="chipgrid">${chipCells(1, "o")}</div><small>RG DS<br>Plus</small></div>
      </div></div>
    </article>
    <article class="t c5 night rise">
      <div class="flat"><div><h3>Price</h3>
      <span class="big m">${count(PRICE.duo / PRICE.rg, x(PRICE.duo, PRICE.rg), 0, "", "×")}</span>
      <p>Drawn by area. The one result here that goes the other way.</p></div>
      <div class="area">
        <div><i class="a"></i><small>$1,999</small></div>
        <div><i class="b"></i><small>$94.99</small></div>
      </div></div>
    </article>
    <article class="t c4 rise">
      <h3>Refresh rate</h3>
      <span class="big m">2×</span>
      <div class="tick">
        <div>iPhone Duo, up to 120 Hz<div class="lane"><div class="mover f"><i></i></div></div></div>
        <div>RG DS Plus, 60 Hz<div class="lane"><div class="mover s"><i></i></div></div></div>
      </div>
      <p style="margin-top:10px;font-size:12px">Shown at one fifth speed.</p>
    </article>
    <article class="t c4 rise">
      <h3>Battery life</h3>
      <span class="big m">4×</span>
      <div class="batt">
        <div>iPhone Duo, up to 24 h<div class="cell"><i style="--v:100;background:var(--duo)"></i></div></div>
        <div>RG DS Plus, about 6 h<div class="cell"><i style="--v:25;background:var(--rg)"></i></div></div>
      </div>
    </article>
    <article class="t c4 w rise">
      <h3>Weight</h3>
      <span class="big m">90 g</span>
      <p>The one that costs less weighs more.</p>
      <svg class="scale" viewBox="0 0 240 118" role="img" aria-label="A balance: iPhone Duo 254 grams rises, RG DS Plus 344 grams sinks">
        <path d="M120 22V108M92 110h56" fill="none" stroke="#86868b" stroke-width="3" stroke-linecap="round"/>
        <path class="beam" d="M30 22H210" stroke="#1d1d1f" stroke-width="3" stroke-linecap="round"/>
        <circle cx="120" cy="22" r="5" fill="#1d1d1f"/>
        <g class="panl"><path d="M30 22v30" stroke="#86868b"/><rect x="2" y="52" width="56" height="30" rx="8" fill="#8e8e93"/><text x="30" y="71" style="fill:#fff">254 g</text></g>
        <g class="panr"><path d="M210 22v30" stroke="#86868b"/><rect x="182" y="52" width="56" height="30" rx="8" fill="#f0663c"/><text x="210" y="71" style="fill:#fff">344 g</text></g>
      </svg>
    </article>
    <article class="t c7 rise">
      <h3>Things the iPhone Duo does not have</h3>
      <div class="lacks">
        <span class="h"></span><span class="h">iPhone Duo</span><span class="h">RG DS Plus</span>
        ${LACKS.map(([label, d, r]) => `<span>${label}</span><span class="v">${dots(d, "d")}</span><span class="v">${dots(r, "r")}</span>`).join("\n        ")}
      </div>
    </article>
    <article class="t c5 rise">
      <h3>Single-core points per dollar</h3>
      <span class="big m">${(GB.duo.s / PRICE.duo).toFixed(2)} <span style="color:var(--faint)">vs</span> ${(GB.rg.s / PRICE.rg).toFixed(2)}</span>
      <p>This was the chart we made to win. The iPhone Duo wins it.</p>
      <div class="fill"></div>
      ${pairBar("Points for each dollar", GB.duo.s / PRICE.duo, GB.rg.s / PRICE.rg, (GB.duo.s / PRICE.duo).toFixed(2), (GB.rg.s / PRICE.rg).toFixed(2))}
    </article>
  </div>
</section>

<section class="both pin long" style="margin-top:clamp(20px,4vw,50px)">
  <div class="stick">
    <h2>And on both of them:</h2>
    <div class="venn" role="group" aria-label="What each computer has, and what both have">
      <div class="disc a"></div><div class="disc b"></div>
      <div class="only a"><h3>Only on the iPhone Duo</h3><ul><li>Camera</li><li>5G</li><li>120 Hz</li><li>24 h battery</li><li>App Store</li></ul></div>
      <div class="only b"><h3>Only on the RG DS Plus</h3><ul><li>D-pad</li><li>Analog stick</li><li>Second screen</li><li>Two microSD slots</li><li>Stylus</li><li>Headphone jack</li></ul></div>
      <ul class="common" aria-label="On both">${icons}</ul>
    </div>
    <p class="both-note">The iPhone Duo has the App Store. Omarchy Pocket has <a href="https://applets.pocket.nexus/">applets</a> built with <a href="https://pocketjs.dev/">PocketJS</a>.</p>
  </div>
</section>

<section class="sec">
  <div class="smooth rise">
    <div>
      <p class="eyebrow">Smoothness</p>
      <h2>176 points.<br>60 frames a second.</h2>
      <p>Omarchy Pocket replaces the desktop graphics stack with one <a href="https://pocketjs.dev/">PocketJS</a> process. Windows move at 60 fps on a chip with a twenty-seventh of the speed.<sup>2</sup> This is a recording from the device.</p>
      <div class="stats4">
        <div>${count(176, "176")}<span>Geekbench points<sup>1</sup></span></div>
        <div>${count(60, "60")}<span>frames a second<sup>2</sup></span></div>
        <div>${count(557, "557")}<span>of 953 MB free, with Tailscale and a proxy on</span></div>
        <div>${count(1, "1")}<span>graphics process</span></div>
      </div>
      ${pairBar("Geekbench points available per frame", GB.duo.s / 120, GB.rg.s / 60, (GB.duo.s / 120).toFixed(1), (GB.rg.s / 60).toFixed(1))}
      <p class="fine">A metric we devised for this page and do not defend.</p>
    </div>
    <div class="screen"><video src="/shots/chords.mp4" poster="/shots/chords-top.webp" muted loop playsinline preload="metadata" aria-label="A recording of Omarchy Pocket moving windows on the RG DS Plus"></video></div>
  </div>
</section>

<section class="fleet pin long" style="margin-top:clamp(20px,4vw,50px)">
  <div class="stick">
    <div class="fleet-in">
      <h2>Or, for one iPhone Duo:</h2>
      <div class="lot">
        <div class="one"><img src="/vs/iphone-duo/iphone-duo.svg" width="1178" height="1646" alt="One iPhone Duo"><small>$1,999</small></div>
        <div class="herd" aria-label="${fleet} RG DS Plus units">${fleetCells}</div>
      </div>
      <div class="tally">
        <div class="sp"><b id="f-cost">$${num(+(fleet * PRICE.rg).toFixed(2))}</b><span id="f-left">$${(PRICE.duo - fleet * PRICE.rg).toFixed(2)} left</span></div>
        <div><b id="f-cores">${fleet * 4}</b><span>cores</span></div>
        <div><b id="f-gb">${fleet} GB</b><span>of memory</span></div>
        <div><b id="f-screens">${fleet * 2}</b><span>screens</span></div>
        <div><b id="f-kg">${(fleet * 0.344).toFixed(1)} kg</b><span>in your pocket</span></div>
      </div>
      <div class="race">
        <div class="race-t"><div class="race-f" style="--n:${fleet}"></div></div>
        <div class="race-l"><span>Their multi-core scores added together: <b id="f-sum">${num(fleet * GB.rg.m)}</b></span><span><b>${num(GB.duo.m)}</b>, one iPhone Duo</span></div>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <h2 class="sec-h rise">Every line.</h2>
  <p class="sec-p rise">Geekbench does not add up that way, and it still would not have been enough. Here is the rest.</p>
  <div class="score rise" role="img" aria-label="${wins("duo")} lines to the iPhone Duo, ${wins("rg")} to the RG DS Plus, ${wins("tie")} the same">
    <div style="--v:${wins("duo")}">${wins("duo")} iPhone Duo</div><div style="--v:${wins("rg")}">${wins("rg")} RG DS Plus</div><div style="--v:${wins("tie")}">${wins("tie")} the same</div>
  </div>
  <table>
    <thead><tr><th></th><th><span class="ph"><img src="/vs/iphone-duo/iphone-duo.svg" alt="">iPhone Duo</span></th><th><span class="ph"><img src="/vs/iphone-duo/rg-mini.webp" alt="">RG DS Plus</span></th></tr></thead>
    ${compare}
  </table>
</section>

<section class="close">
  <div class="close-in">
    <h2 class="rise">The iPhone Duo is the better computer.</h2>
    <p class="then rise"><span style="color:#ffb97a">This one has a D-pad.</span></p>
    <div class="ctas rise">
      <a class="cta" href="${BUY}" rel="sponsored noopener" target="_blank">Get an RG DS Plus for $94.99 ↗</a>
      <a class="cta alt" href="/demo/">Try it in your browser</a>
    </div>
  </div>
  <img class="dpad" src="/vs/iphone-duo/dpad.webp" width="1800" height="1093" alt="The D-pad and analog stick of an RG DS Plus, up close" loading="lazy">
</section>

<footer class="fine-print">
  <ol>
    <li>The RG DS Plus's Geekbench figures come from other RK3568 boards, not from this handheld. The iPhone Duo's come from Tom's Guide. We did not test an iPhone Duo.</li>
    <li>Measured on our device. Its 557 of 953 MB free was read on 2 Nov 2026.</li>
  </ol>
  <h3>Sources</h3>
  <ol>${SOURCE_LIST}</ol>
  <p style="margin-top:18px">iPhone Duo is a trademark of Apple Inc. This page is not affiliated with or endorsed by Apple or Anbernic. The drawing of the iPhone Duo is ours, to scale from published dimensions.</p>
  <p style="margin-top:12px">© 2026 <a href="https://pocket.nexus/">Pocket Nexus</a></p>
</footer>
<script>${SCRIPT}</script>
</body>
</html>
`);
console.log("vs:", all.length, "lines;", wins("duo"), "duo,", wins("rg"), "rg,", wins("tie"), "same; fleet", fleet);
