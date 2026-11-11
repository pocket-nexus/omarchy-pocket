// omapocket.org/docs: how to install Omarchy Pocket on each device, one page
// a device, with the device's own captures and recordings.
//
//   bun site/docs.ts            the pages into public/docs/, and the media they
//                               use into public/docs/media/ from the sources below
//   bun site/docs.ts --pages    the pages only
//
// Media sources (the ignored .pocket-build/validation tree, as site/shots.ts):
//   uconsole/<name>.png         the uConsole's stage read back from the GPU (1280 x 720)
//   uconsole/session.mp4        the uConsole's panel recorded off KMS (ffmpeg kmsgrab), turned upright
//   docs/thor-film.mp4          the AYN Thor's launch film (4K)
// and docs/media/ (the README's pictures). The RG DS Plus's and the Thor's
// panel captures and chord videos are the landing page's (public/shots).
import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITE = import.meta.dir;
const REPO = join(SITE, "..");
const OUT = join(SITE, "public", "docs");
const MEDIA = join(OUT, "media");
const V = join(REPO, ".pocket-build", "validation");
/** the release the pages describe (uconsole/release.json's and the Thor's versionName) */
const VERSION = "0.2.0";
const RELEASES = "https://github.com/pocket-nexus/omarchy-pocket/releases";
const TAG = `${RELEASES}/tag/v${VERSION}`;
const DOWNLOAD = `${RELEASES}/download/v${VERSION}`;
const DEB = `omarchy-pocket-uconsole_${VERSION}_arm64.deb`;
const REPO_URL = "https://github.com/pocket-nexus/omarchy-pocket";

/** The uConsole's captures the page shows, by the name it uses. */
const UCONSOLE_SHOTS: Record<string, string> = {
  terminals: "w1",
  window: "w2",
  legend: "final",
  move: "mv1",
  help: "help",
  sheet: "sheet",
  menu: "f1",
  hn: "hn5",
  story: "hn7",
  typing: "hw-type",
  lock: "lock2",
  system: "sysmenu",
  desktop: "desktop",
};

async function media() {
  mkdirSync(join(MEDIA, "uconsole"), { recursive: true });
  for (const [name, source] of Object.entries(UCONSOLE_SHOTS)) {
    const from = join(V, "uconsole", `${source}.png`);
    const to = join(MEDIA, "uconsole", `${name}.webp`);
    if (!existsSync(from)) {
      if (!existsSync(to)) throw new Error(`missing ${from}`);
      continue;
    }
    await $`magick ${from} -quality 82 -define webp:method=6 ${to}`.quiet();
  }
  const session = join(V, "uconsole", "session.mp4");
  if (existsSync(session)) {
    await $`ffmpeg -loglevel error -y -i ${session} -vf scale=1280:-2,fps=30 -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -an -movflags +faststart ${join(MEDIA, "uconsole", "session.mp4")}`;
    await $`ffmpeg -loglevel error -y -ss 14.5 -i ${join(MEDIA, "uconsole", "session.mp4")} -frames:v 1 -q:v 2 ${join(MEDIA, "uconsole", "session-poster.jpg")}`;
  }
  const film = join(V, "docs", "thor-film.mp4");
  if (existsSync(film)) {
    await $`ffmpeg -loglevel error -y -i ${film} -vf scale=1280:-2 -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart ${join(MEDIA, "thor-film.mp4")}`;
    await $`ffmpeg -loglevel error -y -ss 27 -i ${join(MEDIA, "thor-film.mp4")} -frames:v 1 -q:v 2 ${join(MEDIA, "thor-film-poster.jpg")}`;
  }
  for (const name of ["rg-ds-plus.webp", "screens.webp", "applets.webp"]) copyFileSync(join(REPO, "docs", "media", name), join(MEDIA, name));
  console.log("media:", MEDIA);
}

// ---- markup -----------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (s: string) => `<pre><code>${esc(s.trim())}</code></pre>`;
const kbd = (s: string) => `<kbd>${esc(s)}</kbd>`;
const table = (head: string[], rows: string[][]) =>
  `<div class="table"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const shot = (src: string, alt: string, caption: string, wide = false) =>
  `<figure class="shot${wide ? " wide" : ""}"><img src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async"><figcaption>${caption}</figcaption></figure>`;
/** A dual-screen device's two panels, the upper over the lower. */
const pair = (top: string, bottom: string, alt: string, caption: string, thor = false) =>
  `<figure class="pair${thor ? " thor" : ""}"><div class="screens"><img src="${top}" alt="${esc(alt)}, upper screen" loading="lazy"><img src="${bottom}" alt="${esc(alt)}, lower screen" loading="lazy"></div><figcaption>${caption}</figcaption></figure>`;
const video = (src: string, poster: string, caption: string, label: string) =>
  `<figure class="shot wide"><video src="${src}" poster="${poster}" controls playsinline muted preload="none" aria-label="${esc(label)}"></video><figcaption>${caption}</figcaption></figure>`;
const steps = (items: string[]) => `<ol class="steps">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const note = (kind: "note" | "warn", body: string) => `<aside class="callout ${kind}">${body}</aside>`;
const facts = (items: [string, string][]) => `<dl class="facts">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

/** The uConsole's controls, drawn from ClockworkPi's front view: the panel's
 *  bottom edge with the controls row's words over each control, the row, and
 *  the keyboard's top-left keys. Positions are fractions of the panel's width. */
function uconsoleControls(): string {
  const W = 640;
  const x = (f: number) => 20 + f * (W - 40);
  const t = (cx: number, y: number, s: string, cls = "") => `<text x="${cx.toFixed(1)}" y="${y}" class="${cls}" text-anchor="middle">${esc(s)}</text>`;
  const words: [number, number, string][] = [[0.13, 66, "Focus"], [0.295, 66, "Click"], [0.34, 84, "Back"], [0.648, 66, "Point"], [0.79, 66, "Split"], [0.878, 66, "Full"], [0.835, 84, "Close"], [0.922, 84, "Menu"]];
  const dpad = x(0.13);
  const parts = [
    `<rect x="8" y="8" width="${W - 16}" height="292" rx="22" class="body"/>`,
    `<rect x="20" y="20" width="${W - 40}" height="78" rx="6" class="panel"/>`,
    t(W / 2, 40, "SUPER  Window: the panel's bottom edge while a layer is up", "cap"),
    ...words.map(([f, y, s]) => t(x(f), y, s, "word")),
    // the D-pad
    `<path d="M${dpad - 9} ${118}h18v18h18v18h-18v18h-18v-18h-18v-18h18z" class="ctl"/>`,
    t(dpad, 194, "D-pad", "lab"),
    // L above and left of R
    `<circle cx="${x(0.295)}" cy="128" r="11" class="ctl"/>`,
    t(x(0.295), 132, "L", "key"),
    `<circle cx="${x(0.34)}" cy="152" r="11" class="ctl"/>`,
    t(x(0.34), 156, "R", "key"),
    t((x(0.295) + x(0.34)) / 2, 194, "mouse buttons", "lab"),
    // the trackball
    `<circle cx="${x(0.648)}" cy="140" r="17" class="ball"/>`,
    t(x(0.648), 194, "trackball (press: click)", "lab"),
    // Y X over B A
    ...([[0.79, 128, "Y"], [0.878, 128, "X"], [0.835, 152, "B"], [0.922, 152, "A"]] as [number, number, string][]).flatMap(([f, y, s]) => [
      `<circle cx="${x(f)}" cy="${y}" r="11" class="ctl"/>`,
      t(x(f), y + 4, s, "key"),
    ]),
    t(x(0.856), 194, "A B X Y", "lab"),
    // the keyboard's top row, left end
    `<rect x="34" y="218" width="${W - 68}" height="68" rx="10" class="kb"/>`,
    ...([[64, "Esc"], [124, "SELECT"], [190, "START"]] as [number, string][]).flatMap(([cx, s]) => [`<rect x="${cx - 26}" y="228" width="52" height="22" rx="4" class="k${s === "START" ? " hot" : ""}"/>`, t(cx, 243, s, "kk")]),
    t(190, 270, "SUPER", "lab hot"),
    t(124, 270, "hold: scroll", "lab"),
    t(W / 2 + 80, 258, "Q W E R T Y … the keyboard types", "lab"),
  ];
  return `<figure class="diagram"><svg viewBox="0 0 ${W} 308" role="img" aria-label="The uConsole's controls under its panel: the D-pad, L and R, the trackball, A B X Y, and Esc, SELECT and START on the keyboard's top row">${parts.join("")}</svg><figcaption>The controls row under the uConsole's panel. While a SUPER layer is up, the panel's bottom edge names what each control does, right above it.</figcaption></figure>`;
}

const NAV = [
  { href: "/docs/", label: "Overview" },
  { href: "/docs/rg-ds-plus/", label: "RG DS Plus" },
  { href: "/docs/ayn-thor/", label: "AYN Thor" },
  { href: "/docs/uconsole/", label: "ClockworkPi uConsole" },
];

function page(path: string, title: string, description: string, body: string, toc: [string, string][] = []): string {
  const side = `<nav class="side" aria-label="Docs"><p class="side-h">Install</p>${NAV.map((n) => `<a href="${n.href}"${n.href === path ? ' aria-current="page"' : ""}>${n.label}</a>`).join("")}<p class="side-h">Release</p><a href="${TAG}">v${VERSION} on GitHub</a><a href="${REPO_URL}">Source</a>${
    toc.length ? `<p class="side-h">On this page</p>${toc.map(([id, label]) => `<a class="toc" href="#${id}">${label}</a>`).join("")}` : ""
  }</nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · Omarchy Pocket</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://omapocket.org${path}">
<meta name="theme-color" content="#0e0a18">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Omarchy Pocket">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://omapocket.org${path}">
<meta property="og:image" content="https://omapocket.org/og-image.png">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/docs/docs.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/"><img src="/favicon.svg" alt="" width="22" height="22">Omarchy Pocket</a>
  <nav class="links"><a href="/">Home</a><a href="/docs/" aria-current="true">Docs</a><a href="/demo/">Live demo</a><a class="ghost" href="${REPO_URL}">GitHub</a></nav>
</header>
<div class="layout">
${side}
<main class="doc">
${body}
<footer class="foot"><p>Omarchy Pocket ${VERSION}. Every screen on these pages is the device's own, read back from its GPU or recorded off its display; the RG DS Plus's body around its screens is a 3D model. <a href="${REPO_URL}/issues">Report a problem</a></p></footer>
</main>
</div>
</body>
</html>
`;
}

// ---- pages ------------------------------------------------------------------

function overview(): string {
  const card = (href: string, img: string, alt: string, name: string, how: string, line: string, badge: string) =>
    `<a class="card" href="${href}"><img src="${img}" alt="${esc(alt)}" loading="lazy"><div><p class="badge">${badge}</p><h3>${name}</h3><p class="how">${how}</p><p>${line}</p></div></a>`;
  const body = `
<p class="eyebrow">Docs</p>
<h1>Install Omarchy Pocket</h1>
<p class="lead">Omarchy Pocket puts Omarchy's command line, themes, menu and services under one shell made for handhelds. Each device takes it its own way. Pick yours.</p>
<div class="cards">
${card("/docs/rg-ds-plus/", "/docs/media/rg-ds-plus.webp", "The RG DS Plus open, a terminal and a clock on its upper screen and the keyboard on its lower one", "Anbernic RG DS Plus", "The SD card's system", "Replaces the stock launcher; the stock system stays as the rescue boot. Built and installed from source.", "From source")}
${card("/docs/ayn-thor/", "/shots/thor/tile4-top.webp", "The AYN Thor's upper screen: a terminal, Notes, a clock and Activity tiled", "AYN Thor", "An Android app", "Install the app, give it the Linux root, play. Nothing rooted, nothing replaced.", "From the release")}
${card("/docs/uconsole/", "/docs/media/uconsole/legend.webp", "The uConsole's panel with SUPER on: the controls row along its bottom edge", "ClockworkPi uConsole", "A Debian package", "One apt install beside Raspberry Pi OS. Its menu gives the panel back to the desktop.", "From the release")}
</div>

<h2 id="release">The release</h2>
<p>Version ${VERSION} is on <a href="${TAG}">GitHub</a>. Check each file against <code>SHA256SUMS</code>.</p>
${table(["File", "For", "Size"], [
  [`<code>${DEB}</code>`, "ClockworkPi uConsole", "3.5 MB"],
  [`<code>omarchy-pocket-${VERSION}.apk</code>`, "AYN Thor", "65 MB"],
  ["<code>omarchy-pocket-root.tar.zst</code>", "AYN Thor, uConsole: Omarchy's Arch Linux ARM root", "802 MB"],
  ["<code>SHA256SUMS</code>", "every file", ""],
])}

<h2 id="same-shell">One shell, three machines</h2>
<p>The same shell runs on all three: Omarchy's bar, its menu, windows tiled the way Omarchy tiles them, Pocket Term, and the applets. What changes is how your hands reach it.</p>
${table(["", "RG DS Plus", "AYN Thor", "uConsole"], [
  ["Screens", "Two 4″, 1024 × 768", "6″ 1080p over a 3.92″ touch screen", "One 5″, 1280 × 720"],
  ["Typing", "The lower screen's keyboard", "The lower screen's keyboard", "Its own keyboard"],
  ["Pointing", "The lower screen's trackpad", "The lower screen's trackpad", "The trackball, with L and R as mouse buttons"],
  ["SUPER", "L1 and R1, held", "L1 and R1, held", "START, tapped or held"],
  ["Back to stock", "The boot chooser, or the card's backup", "Uninstall the app", "System › Raspberry Pi Desktop, or <code>apt remove</code>"],
])}

<h2 id="help">Help</h2>
<p>Something not working? <a href="${REPO_URL}/issues">Open an issue</a> with your device, the release you installed, and what you saw. Each device's page lists the logs worth attaching.</p>
`;
  return page("/docs/", "Install Omarchy Pocket", "How to install Omarchy Pocket on the RG DS Plus, the AYN Thor and the ClockworkPi uConsole.", body, [["release", "The release"], ["same-shell", "One shell, three machines"], ["help", "Help"]]);
}

function uconsole(): string {
  const S = (name: string) => `/docs/media/uconsole/${name}.webp`;
  const hasVideo = existsSync(join(MEDIA, "uconsole", "session.mp4"));
  const body = `
<p class="eyebrow">Install · ClockworkPi uConsole</p>
<h1>ClockworkPi uConsole</h1>
<p class="lead">A Debian package beside Raspberry Pi OS. One command installs it. Its own menu gives the panel back to the desktop.</p>
${shot(S("terminals"), "Two terminals tiled under Omarchy's bar on the uConsole", "Two Pocket Term windows tiled on the uConsole's panel, under Omarchy's bar.", true)}
${facts([
  ["Release", `<a href="${TAG}">v${VERSION}</a>: <code>${DEB}</code>`],
  ["Runs on", "A uConsole with a Raspberry Pi CM4, on ClockworkPi's Raspberry Pi OS 13 (trixie), 64-bit"],
  ["Space", "3.5 GB free: an 802 MB download that unpacks to 2.7 GB"],
  ["Time", "About 10 minutes, most of it the download"],
])}

<h2 id="before">Before you start</h2>
<ul>
<li>The uConsole runs ClockworkPi's Raspberry Pi OS 13 image with its desktop, and you are logged in as its user (the one with uid 1000) with <code>sudo</code>.</li>
<li>It is online: the package downloads Omarchy's root from the release.</li>
<li><code>df -h /</code> shows at least 3.5 GB available.</li>
</ul>
${note("note", "Tested on a CM4 Rev 1.0 with 4 GB and kernel 6.12. Other cores (CM5, A06, R01) are not tested yet.")}

<h2 id="install">Install</h2>
${steps([
  `Open a terminal on the desktop, or SSH into the uConsole, and download the package:${code(`curl -LO ${DOWNLOAD}/${DEB}`)}`,
  `Install it:${code(`sudo apt install ./${DEB}`)}It downloads <code>omarchy-pocket-root.tar.zst</code> (802 MB), checks its SHA-256 against the one the package carries, and unpacks it into <code>/var/lib/omarchy-pocket/root</code>. At the end it prints the commands below.`,
  `Switch the panel to Omarchy Pocket:${code("omarchy-pocket-session on")}or pick <b>Omarchy Pocket</b> in the desktop's menu (System). The desktop closes, and Omarchy Pocket comes up in a few seconds.`,
])}
${note("note", "No network on the uConsole? Download <code>omarchy-pocket-root.tar.zst</code> elsewhere, copy it to <code>/var/cache/omarchy-pocket/</code>, then install the package: it takes the file instead of downloading it. <code>sudo /usr/lib/omarchy-pocket/omarchy-root install</code> runs that step again on its own.")}

<h2 id="first-start">First start</h2>
<p>Omarchy Pocket starts on the Tokyo Night theme, with Omarchy's bar along the top. The lock screen takes your own login password. To open a terminal, tap ${kbd("START")}, then press ${kbd("Return")}.</p>
<div class="grid2">
${shot(S("typing"), "A command typed on the uConsole's keyboard into Pocket Term", "Typing on the keyboard goes to the terminal.")}
${shot(S("lock"), "The lock screen with the password field on the stage", "The lock takes your login password; the field sits above the panel's bottom edge.")}
</div>

<h2 id="controls">Controls</h2>
<p>The uConsole has no shoulder buttons, and the thumb on the D-pad cannot also hold a modifier beside it. So ${kbd("START")}, under the left thumb, is SUPER:</p>
<ul>
<li><b>Held</b>, it is SUPER while it is down: ${kbd("START")} + ${kbd("A")} opens the menu.</li>
<li><b>Tapped</b>, SUPER stays on, so the left thumb can walk the D-pad from window to window. Tap again for the move layer (SUPER + Shift). Tap a third time, or press ${kbd("Esc")}, to leave.</li>
</ul>
${uconsoleControls()}
${table(["Control", "No SUPER", "SUPER (START)", "SUPER + Shift (START twice)"], [
  ["D-pad", "Arrows", "Focus a window; past the last one, the next workspace", "Swap windows; past the last one, carry it to the next workspace"],
  ["A", "Enter", "Omarchy's menu", "Open another"],
  ["B", "Backspace", "Close", "Reopen closed"],
  ["X", "Tab", "Fullscreen", "Maximize"],
  ["Y", "Space", "Toggle split", "Swap split"],
  ["SELECT", "Alone: the controls row; held: the ball scrolls", "Key sheet", "Hide or show the bar"],
  ["L / ball press", "Click; hold to drag", "Click", "Click"],
  ["R", "Back (in an applet or the menu); Omarchy's menu on the wallpaper", "Back", "Back"],
  ["SELECT + roll", "Scroll", "Previous or next workspace", "Previous or next workspace"],
])}
<p>Under SUPER, the keyboard has Omarchy's own bindings: ${kbd("Return")} terminal, ${kbd("Space")} menu, ${kbd("W")} close, ${kbd("F")} fullscreen, ${kbd("J")} split, ${kbd("L")} layout, ${kbd("1")}–${kbd("5")} a workspace (with Shift: carry the window there), ${kbd("[")} ${kbd("]")} or ${kbd("Tab")} the workspace before or after, ${kbd("-")} ${kbd("=")} resize, ${kbd("K")} every binding, ${kbd("Esc")} the System menu. The keyboard's own Cmd key (${kbd("Fn")} + ${kbd("Alt")}) works as SUPER too.</p>
<div class="grid2">
${shot(S("legend"), "SUPER latched, with the controls row along the panel's bottom edge", "SUPER on: each control's word sits right above it.")}
${shot(S("move"), "The move layer swapping two tiled terminals", "Tapped twice, the move layer: the D-pad swaps windows.")}
${shot(S("help"), "The plain controls row SELECT shows", "SELECT on its own: what each control does right now.")}
${shot(S("sheet"), "The key sheet listing every binding", "START + K: every binding.")}
</div>
${hasVideo ? video("/docs/media/uconsole/session.mp4", "/docs/media/uconsole/session-poster.jpg", "The uConsole's panel recorded off its display (KMS): START tapped and a terminal, fastfetch, a second terminal, focus walked with the D-pad, the move layer swapping them, START + A for the menu, Hacker News made fullscreen, scrolled with SELECT + the ball, a story opened with L and closed with R, and SELECT's controls row.", "A recording of the uConsole's panel") : ""}

<h2 id="apps">Menu and applets</h2>
<p>Omarchy's menu (${kbd("START")} + ${kbd("A")}, or a click on the logo) takes typing: type a few letters to filter it. Hacker News, YouTube, Maps, Podcasts, Weather, GitHub, X, Discord and Home Assistant open in windows. Point at them with the trackball, click with ${kbd("L")}, scroll with ${kbd("SELECT")} + roll, and go back with ${kbd("R")}.</p>
<div class="grid2">
${shot(S("menu"), "The Apps list filtered by typing hacker", "Typing filters the menu.")}
${shot(S("hn"), "Hacker News in a window", "Hacker News; a click opens a story, R goes back.")}
</div>

<h2 id="switch">Back to the Raspberry Pi desktop</h2>
${table(["To switch", "From Omarchy Pocket", "From the desktop", "Anywhere"], [
  ["To the desktop now", "Menu › System › <b>Raspberry Pi Desktop</b>", "", "<code>omarchy-pocket-session off</code>"],
  ["To Omarchy Pocket now", "", "Menu › System › <b>Omarchy Pocket</b>", "<code>omarchy-pocket-session on</code>"],
  ["What starts at boot", "", "", "<code>omarchy-pocket-session boot</code> or <code>desktop</code>"],
])}
<div class="grid2">
${shot(S("system"), "Omarchy's System menu with Raspberry Pi Desktop under Lock", "Omarchy's System menu: Raspberry Pi Desktop gives the panel back.")}
${shot(S("desktop"), "The Raspberry Pi desktop after switching back", "A moment later, the Raspberry Pi desktop, on the same Wi‑Fi.")}
</div>
<p>Wi‑Fi, Bluetooth and sound are Raspberry Pi OS's own, so a network joined on one side works on the other. Omarchy's files live in its own root, <code>/var/lib/omarchy-pocket/root</code>: its home is <code>/var/lib/omarchy-pocket/root/home/omarchy</code> as the desktop sees it.</p>

<h2 id="update">Update and uninstall</h2>
<ul>
<li><b>Update:</b> download a newer package and <code>sudo apt install</code> it the same way. The root stays.</li>
<li><b>Uninstall:</b> <code>sudo apt remove omarchy-pocket-uconsole</code> gives the panel back to the desktop, now and at boot. The root stays.</li>
<li><b>Remove everything:</b> <code>sudo apt purge omarchy-pocket-uconsole</code> also deletes the root, with Omarchy's home in it.</li>
</ul>

<h2 id="trouble">If something is wrong</h2>
<ul>
<li>The shell's log: <code>journalctl -t omarchy-pocket-host</code>. The daemon's: <code>journalctl -u omarchy-pocketd</code>.</li>
<li>Back to the desktop from SSH: <code>omarchy-pocket-session off</code>.</li>
<li>Not there yet: voice input (the uConsole has no microphone), typing Chinese, SUPER + drag.</li>
</ul>
`;
  return page("/docs/uconsole/", "Install on the ClockworkPi uConsole", "Install Omarchy Pocket on the ClockworkPi uConsole with one Debian package, beside Raspberry Pi OS's desktop.", body, [
    ["before", "Before you start"], ["install", "Install"], ["first-start", "First start"], ["controls", "Controls"], ["apps", "Menu and applets"], ["switch", "Back to the desktop"], ["update", "Update and uninstall"], ["trouble", "If something is wrong"],
  ]);
}

function thor(): string {
  const T = (scene: string) => [`/shots/thor/${scene}-top.webp`, `/shots/thor/${scene}-bottom.webp`] as const;
  const body = `
<p class="eyebrow">Install · AYN Thor</p>
<h1>AYN Thor</h1>
<p class="lead">An Android app. Nothing rooted, nothing replaced: the upper screen is the monitor, the touch screen the keyboard and trackpad, the Odin controller the gamepad.</p>
${pair(...T("tile4"), "Omarchy Pocket on the AYN Thor", "A terminal, Notes, a clock and Activity tiled on the upper screen, the keyboard on the lower one.", true)}
${facts([
  ["Release", `<a href="${TAG}">v${VERSION}</a>: <code>omarchy-pocket-${VERSION}.apk</code> and <code>omarchy-pocket-root.tar.zst</code>`],
  ["Runs on", "The AYN Thor on AYN's Android 13 firmware"],
  ["Space", "3.5 GB free: the 802 MB root, unpacked into the app's own files"],
  ["Time", "About 10 minutes"],
])}

<h2 id="install">Install</h2>
${steps([
  `On the Thor, open the <a href="${TAG}">release</a> in the browser and download <code>omarchy-pocket-${VERSION}.apk</code> and <code>omarchy-pocket-root.tar.zst</code>.`,
  "Open the APK and install it. Android asks once to let the browser or the file manager install apps.",
  `Open <b>Omarchy Pocket</b>. With no Linux root yet, the upper screen says so. Press ${kbd("START")}, and pick <code>omarchy-pocket-root.tar.zst</code> in the file picker. The app copies it and unpacks the root, which takes a few minutes.`,
  `Unlock with the password <code>omarchy</code>.`,
])}
${note("note", "A Thor with a build from source on it (signed with the debug key) has to uninstall that first, which removes its root: Android installs an update only over the same signature.")}

<h2 id="controls">Controls</h2>
<p>The shoulders are SUPER. Hold ${kbd("L1")} for the window layer and ${kbd("R1")} for the move layer, both for workspaces. After a quarter of a second, the lower screen draws the buttons around it and what each does. With no shoulder held, the gamepad types: the D-pad is the arrows, ${kbd("A")} Enter, ${kbd("B")} Backspace, ${kbd("X")} Tab, ${kbd("Y")} Space, ${kbd("START")} Escape. ${kbd("SELECT")} shows the keys or folds them away; ${kbd("L1")} + ${kbd("SELECT")} lists everything.</p>
${table(["Held", "D-pad", "A", "B", "X", "Y"], [
  ["L1 (window)", "Focus", "Menu", "Close", "Fullscreen", "Split"],
  ["R1 (move)", "Swap", "Open another", "Reopen closed", "Maximize", "Swap split"],
  ["L1 + R1", "← → workspace, ↑ ↓ carry the window", "", "", "", ""],
])}
${video("/shots/thor/chords.mp4", "/shots/thor/chords-top.webp", "The chord table played on the Thor, both screens recorded off the device.", "The AYN Thor's two screens while chords are pressed")}
<div class="grid2">
${pair(...T("legend"), "The window layer's legend", "Holding L1: the lower screen draws the window layer.", true)}
${pair(...T("network"), "The Network panel", "Wi‑Fi from Omarchy's Network panel, through Android.", true)}
${pair(...T("theme"), "The Lupine theme", "Omarchy's themes recolor everything.", true)}
${pair(...T("split"), "Two terminals over the keyboard", "Two terminals over the keyboard.", true)}
</div>

<h2 id="film">The film</h2>
${video("/docs/media/thor-film.mp4", "/docs/media/thor-film-poster.jpg", "36 seconds of the Thor running Omarchy Pocket, filmed on the device.", "The AYN Thor launch film")}

<h2 id="update">Update and uninstall</h2>
<ul>
<li><b>Update:</b> install a newer APK over this one. The root stays, and the app puts the new release's daemon and applets into it.</li>
<li><b>Uninstall:</b> Settings › Apps › Omarchy Pocket › Uninstall. That removes the root too.</li>
</ul>

<h2 id="limits">Limits</h2>
<ul>
<li>Programs in the Linux root play no sound. Android's volume and mute work.</li>
<li>AYN's Burn-in Protection Refresher covers both screens from time to time while they are still, and takes the next press.</li>
<li>GitHub and Weather are left out at the Thor's density for now.</li>
</ul>
`;
  return page("/docs/ayn-thor/", "Install on the AYN Thor", "Install Omarchy Pocket on the AYN Thor as an Android app: the app, then its Linux root.", body, [
    ["install", "Install"], ["controls", "Controls"], ["film", "The film"], ["update", "Update and uninstall"], ["limits", "Limits"],
  ]);
}

function rgds(): string {
  const R = (scene: string) => [`/shots/${scene}-top.webp`, `/shots/${scene}-bottom.webp`] as const;
  const body = `
<p class="eyebrow">Install · Anbernic RG DS Plus</p>
<h1>Anbernic RG DS Plus</h1>
<p class="lead">Omarchy Pocket as the SD card's system. The stock Anbernic system stays on the card as the rescue boot.</p>
${shot("/docs/media/rg-ds-plus.webp", "The RG DS Plus open, a terminal, Activity and a clock tiled above the keyboard", "The RG DS Plus: the upper screen is the monitor, the lower one the keyboard and trackpad.", true)}
${facts([
  ["Install", "From source, over SSH from a computer"],
  ["Runs on", "The RG DS Plus on Anbernic's stock firmware, with its 16 GB card"],
  ["Needs", "A Mac with Apple silicon and OrbStack, Bun 1.4.2, Rust with cargo-zigbuild, and access to this repository's submodules"],
  ["Time", "About an hour, most of it building the image"],
])}
${note("warn", "There is no download for the RG DS Plus yet. The image is built from source, and one of the submodules it needs (pocket-hub, the companion's services) is private. The steps below are the procedure the maintainers use.")}
${note("warn", "The install replaces the card's partitions after the stock root: Anbernic's launcher, ports, user data and the ROMs partition. Back up the whole card first; the partition step refuses to run without that backup.")}

<h2 id="build">Build</h2>
${steps([
  `Get the repository and its submodules:${code(`git clone ${REPO_URL} && cd omarchy-pocket
git submodule update --init vendor/pocketjs vendor/applets vendor/pocket-term vendor/pocket-hub
git -C vendor/pocket-hub submodule update --init vendor/pocketjs
bun install --cwd vendor/pocketjs --frozen-lockfile
POCKETJS_ROOT=vendor/pocketjs bun vendor/applets/tools/setup.ts`)}`,
  `Take Omarchy's menu, theme, wallpaper and fonts, and copy the GPU library from the device:${code(`bun tools/omarchy-assets.ts
bun tools/build.ts libs root@<rg-ds-plus>`)}`,
  `Build the programs, then the system image (an arm64 container in OrbStack, about 2.5 GB):${code(`bun tools/build.ts all
bun image/build-root.ts`)}`,
])}

<h2 id="install">Install</h2>
${steps([
  `Reach the device over SSH: on Wi‑Fi as <code>root</code> / <code>root</code>, or over the USB link (<code>docs/usb-link.md</code>).`,
  `Back up the whole card with <code>dd</code> of <code>/dev/mmcblk1</code>, compressed, with its SHA-256 beside it. <code>image/install.ts</code> names the backup it checks for in <code>BACKUP</code>.`,
  `Run the steps:${code(`bun image/install.ts check partition extract configure chooser reboot --ssh "ssh root@<rg-ds-plus>"`)}<code>partition</code> makes one partition for Omarchy Pocket after the stock root, <code>extract</code> unpacks the image, <code>configure</code> keeps the device's SSH keys, Wi‑Fi networks, firmware and modules, and <code>chooser</code> makes the stock root boot into it.`,
  `After the reboot, unlock with the password <code>omarchy</code>.`,
])}

<h2 id="controls">Controls</h2>
<p>The shoulders are SUPER: hold ${kbd("L1")} for the window layer, ${kbd("R1")} for the move layer, both for workspaces, and the lower screen draws what each button does. With no shoulder held, the D-pad is the arrows, ${kbd("A")} Enter, ${kbd("B")} Backspace, ${kbd("X")} Tab, ${kbd("Y")} Space, ${kbd("START")} Escape, and ${kbd("L2")} / ${kbd("R2")} step workspaces.</p>
${video("/shots/chords.mp4", "/shots/chords-top.webp", "The chord table played on the RG DS Plus, both screens.", "The RG DS Plus's two screens while chords are pressed")}
<div class="grid2">
${pair(...R("home"), "The desktop over the trackpad", "The desktop, with the pins and the workspaces on the lower screen.")}
${pair(...R("tile3"), "Three windows over the keyboard", "A terminal, Activity and Clock tiled over the keyboard.")}
${pair(...R("legend"), "The window layer's legend", "Holding L1: the window layer.")}
${pair(...R("hnfull"), "Hacker News over the trackpad", "Hacker News in a window, the trackpad under it.")}
</div>
${shot("/docs/media/screens.webp", "Six captures of the RG DS Plus's two screens", "Both screens, read back from the GPU.", true)}

<h2 id="back">Back to the stock system</h2>
<p>The stock root boots first and pivots into Omarchy Pocket. Its rescue boot brings up SSH, Wi‑Fi and the USB link without the launcher. To go back to Anbernic's system entirely, write the card's backup back with <code>dd</code>.</p>
`;
  return page("/docs/rg-ds-plus/", "Install on the RG DS Plus", "Install Omarchy Pocket as the RG DS Plus's SD card system, from source.", body, [["build", "Build"], ["install", "Install"], ["controls", "Controls"], ["back", "Back to the stock system"]]);
}

const CSS = `
:root{--ink:#fff5ee;--ink-2:#e7d6e4;--muted:#b9a5c6;--gold:#ffc46b;--rose:#ff6f91;--violet:#b28cff;--line:rgba(255,245,238,.14);--panel:rgba(255,255,255,.04);
  --grot:"Space Grotesk",system-ui,sans-serif;--sans:"IBM Plex Sans",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--g:clamp(16px,4vw,40px)}
*{box-sizing:border-box;margin:0}
html{background:#0e0a18;scroll-padding-top:76px}
body{color:var(--ink);font:17px/1.6 var(--sans);background:radial-gradient(1200px 520px at 70% -10%,rgba(178,140,255,.16),transparent 60%),radial-gradient(900px 420px at 0% 0%,rgba(255,111,145,.10),transparent 60%);min-height:100vh}
a{color:var(--gold)}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px var(--g);background:rgba(14,10,24,.78);backdrop-filter:saturate(160%) blur(16px);-webkit-backdrop-filter:saturate(160%) blur(16px);border-bottom:1px solid var(--line);font:500 15px/1 var(--grot)}
.top a{color:var(--ink);text-decoration:none}
.brand{display:flex;align-items:center;gap:10px;font-weight:700}
.links{display:flex;gap:20px;align-items:center}
.links a[aria-current]{color:var(--gold)}
.ghost{padding:9px 13px;border:1px solid var(--line);border-radius:999px}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:clamp(20px,4vw,56px);max-width:1180px;margin:0 auto;padding:28px var(--g) 60px}
.side{position:sticky;top:76px;align-self:start;display:flex;flex-direction:column;gap:2px;font:500 14.5px/1.3 var(--grot)}
.side-h{margin:18px 0 6px;color:var(--muted);font:500 11.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
.side-h:first-child{margin-top:4px}
.side a{padding:7px 10px;border-radius:9px;color:var(--ink-2);text-decoration:none}
.side a:hover{background:var(--panel)}
.side a[aria-current]{background:rgba(178,140,255,.16);color:var(--ink)}
.side a.toc{padding:5px 10px;color:var(--muted);font-size:13.5px}
.doc{min-width:0;max-width:820px}
.eyebrow{color:var(--rose);font:500 13px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}
h1{margin-top:10px;font:700 clamp(36px,5.4vw,58px)/1.02 var(--grot);letter-spacing:-.035em}
h2{margin:48px 0 14px;font:700 clamp(24px,3vw,30px)/1.15 var(--grot);letter-spacing:-.02em}
h3{font:700 20px/1.2 var(--grot)}
.lead{margin-top:14px;max-width:44rem;color:var(--ink-2);font-size:clamp(18px,1.9vw,21px);line-height:1.5}
p,ul,ol{margin-top:12px}
ul,ol{padding-left:1.3em}
li{margin-top:6px}
code{font:14.5px/1.4 var(--mono);color:#ffe2c0;background:rgba(255,196,107,.09);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
pre{margin-top:10px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.35);overflow-x:auto}
pre code{background:none;padding:0;color:#f6e9ff;overflow-wrap:normal}
kbd{display:inline-block;min-width:1.6em;padding:1px 6px;border:1px solid rgba(255,245,238,.28);border-bottom-width:2px;border-radius:6px;background:rgba(255,255,255,.06);font:500 13.5px/1.4 var(--mono);text-align:center}
.steps{counter-reset:s;list-style:none;padding:0}
.steps>li{counter-increment:s;position:relative;margin-top:18px;padding-left:44px}
.steps>li::before{content:counter(s);position:absolute;left:0;top:-1px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--violet),var(--rose));color:#140c22;font:700 15px/1 var(--grot)}
.callout{margin-top:18px;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--violet);border-radius:10px;background:var(--panel);color:var(--ink-2);font-size:15.5px}
.callout.warn{border-left-color:var(--gold)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:22px}
.facts div{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.facts dt{color:var(--muted);font:500 11.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.facts dd{margin-top:8px;font-size:15px;line-height:1.45}
.table{margin-top:16px;overflow-x:auto;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.45}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{color:var(--muted);font:500 12px/1.2 var(--mono);letter-spacing:.04em;text-transform:uppercase;background:rgba(255,255,255,.03)}
tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap;font-weight:600}
figure{margin-top:20px}
figure img,figure video{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line);background:#000}
figcaption{margin-top:8px;color:var(--muted);font-size:14px;line-height:1.45}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:4px}
.grid2 figure{margin-top:16px}
.pair .screens{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;border-radius:18px;background:linear-gradient(180deg,#26203a,#17121f);border:1px solid var(--line)}
.pair .screens img{border-radius:6px;border:0}
.pair.thor .screens img:last-child{width:64.5%}
.diagram svg{display:block;width:100%;height:auto}
.diagram .body{fill:#1d1828;stroke:rgba(255,245,238,.18)}
.diagram .panel{fill:#0b0912;stroke:rgba(178,140,255,.5)}
.diagram .ctl{fill:#2c2540;stroke:rgba(255,245,238,.35)}
.diagram .ball{fill:#3a3150;stroke:var(--gold);stroke-width:1.5}
.diagram .kb{fill:#16121f;stroke:rgba(255,245,238,.12)}
.diagram .k{fill:#2a2438;stroke:rgba(255,245,238,.25)}
.diagram .k.hot{stroke:var(--rose);stroke-width:1.6}
.diagram text{font:500 12px var(--mono);fill:var(--ink-2)}
.diagram .cap{fill:var(--violet);font-size:11px}
.diagram .word{fill:var(--ink);font-size:12.5px}
.diagram .key{fill:var(--ink);font-size:11px}
.diagram .kk{fill:var(--ink-2);font-size:10px}
.diagram .lab{fill:var(--muted);font-size:11px}
.diagram text.hot{fill:var(--rose)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:26px}
.card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--panel);color:var(--ink);text-decoration:none;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-2px);border-color:rgba(178,140,255,.5)}
.card img{width:100%;aspect-ratio:16/10;object-fit:cover;background:#000}
.card div{padding:14px 16px 18px}
.card .badge{margin:0;color:var(--gold);font:500 11.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.card h3{margin-top:10px}
.card .how{margin-top:4px;color:var(--rose);font-size:14.5px}
.card p{margin-top:8px;color:var(--ink-2);font-size:15px;line-height:1.45}
.foot{margin-top:64px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
@media (max-width:900px){.layout{grid-template-columns:1fr}.side{position:static;flex-direction:row;flex-wrap:wrap;gap:6px}.side-h,.side a.toc{display:none}.cards{grid-template-columns:1fr}}
@media (max-width:640px){.links a:not(.ghost):not([aria-current]){display:none}.grid2{grid-template-columns:1fr}td:first-child{white-space:normal}}
`;

if (!process.argv.includes("--pages")) await media();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "docs.css"), CSS.trim() + "\n");
const pages: [string, string][] = [["index.html", overview()], ["rg-ds-plus/index.html", rgds()], ["ayn-thor/index.html", thor()], ["uconsole/index.html", uconsole()]];
for (const [path, html] of pages) {
  mkdirSync(join(OUT, path, ".."), { recursive: true });
  writeFileSync(join(OUT, path), html);
}
console.log(`docs: ${pages.length} pages in ${OUT}`, statSync(OUT).isDirectory() ? "" : "");
