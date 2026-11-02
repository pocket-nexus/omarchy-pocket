// The store's website: three pages drawn from /v1/apps. An app's title, summary
// and author come from whoever published it, so every value goes in as a text
// node, never as markup.
const main = document.getElementById("main");

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "class") el.className = value;
    else if (name.startsWith("on")) el.addEventListener(name.slice(2), value);
    else if (value !== undefined && value !== false) el.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const SCREENS = {
  "dev.pocket-nexus.weather": "weather",
  "dev.pocket-nexus.maps": "maps",
  "dev.pocket-nexus.podcasts": "podcasts",
  "dev.pocket-nexus.hn": "hn",
  "dev.pocket-nexus.youtube": "youtube",
};
const SERVICES = {
  store: "keeps its own settings on the device",
  glyphs: "draws characters the package did not bake",
  maps: "fetches map tiles",
  images: "fetches images",
  x: "acts as your X account",
  discord: "acts as your Discord account",
  homeassistant: "acts on your Home Assistant",
  github: "acts as your GitHub account",
  youtube: "fetches video for you",
  podcasts: "fetches feeds and audio for you",
  weather: "fetches the forecast",
  hn: "fetches Hacker News",
};
const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const day = (ms) => new Date(ms).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
const iconOf = (app, label = "") => h("img", { src: `/v1/icons/${app.icon}`, alt: label, width: 128, height: 128, loading: "lazy" });

let cached = null;
const load = () => (cached ??= fetch("/v1/apps").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => d.apps));

function link(path, props, ...children) {
  return h("a", { href: path, ...props }, ...children);
}

function card(app) {
  return link(`/app/${encodeURIComponent(app.id)}`, { class: "card" },
    iconOf(app),
    h("div", {},
      h("b", {}, app.title),
      h("p", {}, app.summary),
      h("div", { class: "meta" },
        h("span", {}, app.official ? h("span", { class: "tick" }, "✓ official") : `by ${app.author}`),
        h("span", {}, size(app.bytes)),
        h("span", {}, `v${app.version}`),
      ),
    ),
  );
}

function setTitle(title, description) {
  document.title = title ? `${title} · Omarchy Pocket Applets` : "Applets · Omarchy Pocket";
  if (description) document.querySelector('meta[name=description]').setAttribute("content", description);
}

function failed() {
  main.replaceChildren(h("div", { class: "empty" }, "The store did not answer. ", link("/", { class: "link" }, "Try again")));
}

async function home(author) {
  setTitle(author ? `By ${author}` : "");
  const list = h("div", { class: "grid", "aria-live": "polite" });
  const count = h("span", { class: "count" });
  let query = "";
  let filter = "all";
  let apps = [];
  const draw = () => {
    const q = query.trim().toLowerCase();
    const shown = apps.filter((a) => (!author || a.author === author) && (filter === "all" || (filter === "official") === a.official) && (!q || `${a.title} ${a.summary} ${a.author}`.toLowerCase().includes(q)));
    list.replaceChildren(...(shown.length ? shown.map(card) : [h("p", { class: "empty", style: "grid-column:1/-1" }, q ? `Nothing matches “${query.trim()}”.` : "No applets here yet.")]));
    count.textContent = `${shown.length} applet${shown.length === 1 ? "" : "s"}`;
  };
  const seg = (value, label) => h("button", { type: "button", "aria-pressed": String(filter === value), onclick: (e) => { filter = value; for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-pressed", String(b === e.currentTarget)); draw(); } }, label);
  main.replaceChildren(
    author
      ? h("section", { class: "hero" }, link("/", { class: "back" }, "← All applets"), h("h1", {}, `By ${author}`))
      : h("section", { class: "hero" },
          h("h1", {}, "Small apps for a ", h("em", {}, "pocket computer.")),
          h("p", {}, "Applets run in a window on Omarchy Pocket, on the RG DS Plus. Each one is a signed ", h("a", { href: "https://pocketjs.dev/", class: "link" }, "PocketJS"), " package, and you see what it can reach before it installs."),
        ),
    h("div", { class: "tools" },
      h("input", { class: "search", type: "search", placeholder: "Search applets", "aria-label": "Search applets", oninput: (e) => { query = e.target.value; draw(); } }),
      author ? null : h("div", { class: "seg", role: "group", "aria-label": "Who published it" }, seg("all", "All"), seg("official", "Official"), seg("community", "Community")),
      count,
    ),
    list,
    author ? null : h("section", { class: "steps" },
      h("div", { class: "step" }, h("b", {}, "Install on the device"), h("p", {}, "Open ", h("strong", {}, "Store"), " from the menu's Apps list. The website shows the catalog; installing happens on the device, which checks the signature first.")),
      h("div", { class: "step" }, h("b", {}, "Know what it reaches"), h("p", {}, "An app from the store names the hosts it can reach. It cannot see your accounts or another app's data.")),
      h("div", { class: "step" }, h("b", {}, "Make your own"), h("p", {}, "Say what it should do and the device's agent builds it there. ", link("/make", { class: "link" }, "How making and publishing works"), ".")),
    ),
  );
  list.append(h("p", { class: "empty", style: "grid-column:1/-1" }, "Loading the store"));
  try {
    apps = await load();
    draw();
  } catch {
    failed();
  }
}

async function detail(id) {
  main.replaceChildren(h("p", { class: "empty" }, "Loading"));
  let app, versions;
  try {
    const answer = await fetch(`/v1/apps/${encodeURIComponent(id)}/versions`);
    if (answer.status === 404) return missing(`There is no listed applet called ${id}.`);
    if (!answer.ok) throw new Error(answer.status);
    versions = (await answer.json()).versions;
    app = versions[0];
  } catch {
    return failed();
  }
  setTitle(app.title, app.summary);
  const screen = SCREENS[app.id];
  const reach = app.official ? null : app.hosts.length ? `It can reach ${app.hosts.join(", ")}.` : "It reaches nothing on the internet.";
  main.replaceChildren(
    link("/", { class: "back" }, "← All applets"),
    h("section", { class: "head" },
      iconOf(app, `${app.title}'s icon`),
      h("div", {},
        h("h1", {}, app.title),
        h("p", {}, app.summary),
        h("div", { class: "meta" },
          app.official ? h("span", { class: "tick" }, "✓ official") : null,
          h("span", {}, "by ", link(`/author/${encodeURIComponent(app.author)}`, { class: "link" }, app.author)),
          h("span", {}, `v${app.version}`),
          h("span", {}, size(app.bytes)),
          h("span", {}, day(app.created)),
        ),
      ),
    ),
    h("div", { class: "detail" },
      h("div", {},
        screen ? h("img", { class: "shot", src: `/shots/${screen}.webp`, alt: `${app.title} on the top screen of the RG DS Plus`, width: 1024, height: 768 }) : null,
        h("section", { class: "pane" },
          h("h3", {}, "Install"),
          h("ol", { class: "ol" },
            h("li", {}, "On Omarchy Pocket, open the menu (L1 + A, or the logo on the bottom screen)."),
            h("li", {}, "In Apps, open ", h("strong", {}, "Store"), " and find ", h("strong", {}, app.title), "."),
            h("li", {}, "Press ", h("strong", {}, "GET"), ". The device checks the signature before it installs."),
          ),
          h("p", { class: "small", style: "margin-top:12px" }, "No device? ", h("a", { class: "link", href: "https://omapocket.org/demo/" }, "The shell runs in your browser"), ", without applets."),
        ),
      ),
      h("div", {},
        h("section", { class: "pane" },
          h("h3", {}, "What it can reach"),
          h("p", { class: "small" }, app.official ? "From Pocket Nexus: it may use the device's services below." : `${reach} It cannot see your accounts or other apps' data.`),
          app.hosts.length ? h("div", { class: "reach" }, app.hosts.map((host) => h("span", { class: "tag" }, host))) : null,
          app.services.length ? h("dl", { style: "margin-top:12px" }, app.services.flatMap((service) => [h("dt", {}, service), h("dd", {}, SERVICES[service] ?? "a service on the device")])) : null,
        ),
        h("section", { class: "pane" },
          h("h3", {}, "Signed"),
          h("dl", {},
            h("dt", {}, "id"), h("dd", { class: "mono" }, app.id),
            h("dt", {}, "key"), h("dd", { class: "mono" }, app.key),
            h("dt", {}, "sha-256"), h("dd", { class: "mono" }, app.package),
          ),
          h("p", { class: "small", style: "margin-top:10px" }, h("a", { class: "link", href: `/v1/packages/${app.package}`, download: `${app.id}-${app.version}.pocket` }, "Download the package"), ` (${size(app.bytes)})`),
        ),
        h("section", { class: "pane" },
          h("h3", {}, `Version${versions.length === 1 ? "" : "s"}`),
          h("div", { class: "rows" }, versions.map((v) => h("div", {}, h("a", { href: `/v1/packages/${v.package}`, download: `${v.id}-${v.version}.pocket` }, `v${v.version}`), h("span", {}, size(v.bytes)), h("span", {}, day(v.created))))),
        ),
      ),
    ),
  );
}

function missing(message) {
  setTitle("Not here");
  main.replaceChildren(h("section", { class: "hero" }, h("h1", {}, "Not here."), h("p", {}, message), h("p", {}, link("/", { class: "link" }, "All applets"))));
}

function make() {
  setTitle("Make one", "Make an applet for Omarchy Pocket on the device itself, then publish it to the store.");
  const code = (text) => h("pre", {}, h("code", {}, text));
  main.replaceChildren(h("article", { class: "doc" },
    h("section", { class: "hero" },
      h("h1", {}, "Make one ", h("em", {}, "on the device.")),
      h("p", {}, "The toolchain runs on the RG DS Plus. A full compile takes about a minute, with no computer and no Rust."),
    ),
    h("h2", {}, "Ask for it"),
    h("p", {}, "In the menu, ", h("strong", {}, "Apps › Make an Applet"), " asks what the applet should do and starts the coding agent in ", h("code", {}, "~/Applets/<name>"), ". The same steps by hand, from a terminal or any agent:"),
    code("pocket-applet new notes-to-self    # a new applet from the template\npocket-applet check notes-to-self  # the rules, each with what to do instead\npocket-applet run notes-to-self    # compile, install, open the window\npocket-applet shot notes-to-self   # both panels as a PNG, for the agent to read"),
    h("h2", {}, "What it is built from"),
    h("p", {}, "An applet is a ", h("a", { class: "link", href: "https://pocketjs.dev/" }, "PocketJS"), " package. Its pages come from the design system in ", h("a", { class: "link", href: "https://github.com/pocket-nexus/omarchy-pocket/tree/main/applets/kit" }, "applets/kit"), ": a page is a list of rows, and the kit does the measuring, colours, touch, keyboard focus and loading states."),
    h("h2", {}, "Publish it"),
    code("pocket-applet publish notes-to-self --author you"),
    h("ul", {},
      h("li", {}, h("strong", {}, "You are a key."), " The first publish makes an ed25519 key on the device. The first key to use an id or an author name owns it, and later versions must come from that key."),
      h("li", {}, h("strong", {}, "An editor reads it first."), " A new version waits for review, and nothing unlisted can be downloaded."),
      h("li", {}, h("strong", {}, "It says what it reaches."), " The manifest's ", h("code", {}, "applet.hosts"), " names every host, and the device shows them before it installs. Store apps cannot use services that act as the device's owner."),
    ),
    h("p", {}, "The full rules are in ", h("a", { class: "link", href: "https://github.com/pocket-nexus/omarchy-pocket/blob/main/docs/applets.md" }, "docs/applets.md"), "."),
  ));
}

function route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const app = /^\/app\/([^/]+)$/.exec(path);
  const author = /^\/author\/([^/]+)$/.exec(path);
  for (const a of document.querySelectorAll("[data-nav]")) a.toggleAttribute("aria-current", false);
  const lit = path === "/make" ? "make" : "apps";
  document.querySelector(`[data-nav=${lit}]`).setAttribute("aria-current", "page");
  if (path === "/") return home();
  if (path === "/make") return make();
  if (app) return detail(decodeURIComponent(app[1]));
  if (author) return home(decodeURIComponent(author[1]));
  missing("That page is not in the store.");
}

document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a");
  if (!a || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/v1/")) return;
  e.preventDefault();
  history.pushState(null, "", url.pathname);
  scrollTo(0, 0);
  route();
});
addEventListener("popstate", route);
route();
