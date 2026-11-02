# Making and publishing applets

An applet is a PocketJS package in a window of the shell. The toolchain to make one runs on the device, and the store at `oma.pocket.nexus` carries them.

## Making one on the device

**Apps › Make an Applet** asks what the applet should do and starts Codex on it in `~/Applets/<name>`. The same steps by hand, in a terminal or from any coding agent:

| Command | What it does |
|---|---|
| `pocket-applet new <name>` | a new applet from `sdk/template`, with `AGENTS.md` beside it |
| `pocket-applet check <name>` | the rules below, each with what to do instead; `run` and `build` stop on an error, `publish` also on a warning |
| `pocket-applet run <name>` | compiles, installs to `~/.local/share/omarchy-pocket/applets/` and opens the window, replacing a running one |
| `pocket-applet shot <name>` | both panels as `<name>/shot.png`, for the agent to look at |
| `pocket-applet log` | the last lines of the host and the daemon |
| `pocket-applet tap <x> <y>`, `scroll`, `key`, `type` | input to the shell, so an agent can open each page it made |
| `pocket-applet publish <name> --author <handle>` | signs it and sends it to the store |

`~/Applets` is laid out as this repository's `applets/` are, with symlinks into the SDK at `/usr/share/omarchy-pocket/sdk`: `ui`, `lib`, `vendor`, `host`, `node_modules`, and `examples` (the finished applets). `sdk/AGENTS.md` is what the agent reads. `bun tools/build.ts sdk` builds the SDK (89 MiB, installed for linux-arm64) and `bun tools/deploy.ts <host> sdk` installs it.

**An app is built from the design system in `applets/kit`** (`applets/kit/README.md`): a page is a list of rows, and the kit does the measuring, colours, touch, keyboard focus, loading states and text for any script. `applets/github` is a full client built that way. `sdk/check.ts` refuses a page of positioned views, a colour of its own, a host or a service missing from the manifest, a query with no failure state, an emoji and an icon of letters; a file that draws a game or a map names why on its first lines and keeps its own pixels. `sdk/AGENTS.md` is what a coding agent on the device reads, `skills/pocket-applet/SKILL.md` the same for one on a computer.

**Measured on the device:** a full compile of Weather takes 62 s and peaks at 386 MiB of 953 MiB, about 35 s of it the TypeScript check. No Rust toolchain is involved: a package is JavaScript, styles, fonts and images.

## The store

`store/` is a Cloudflare Worker on `oma.pocket.nexus` with D1 (publishers, apps, versions) and R2 (packages and icons, named by SHA-256). `/v1/*` is the Worker; every other path is a static file from `store/site/`, where the landing page goes.

| Route | Answer |
|---|---|
| `GET /v1/catalog?profile=<hex>` | the newest listed version of each app built for that device profile |
| `GET /v1/apps/<id>` | one app's newest listed version |
| `GET /v1/packages/<sha256>`, `/v1/icons/<sha256>` | a listed version's files, immutable |
| `POST /v1/publish` | a signed package, icon, author and summary |
| `/v1/admin/*` | an editor's: pending, review, files |

**A publisher is an ed25519 key**, made on first publish at `~/.config/omarchy-pocket/publisher.pem`. The first key to publish an id or an author name owns it; a later version must come from the same key and be newer. The signature covers the id, version, package hash, icon hash, author and summary, and the device checks it again at install.

**A version from the official key is listed at once. Any other waits for an editor**, and an unlisted file cannot be downloaded. An editor works from a computer holding `~/.config/omarchy-pocket-store`:

```
bun store/admin.ts pending
bun store/admin.ts fetch <id> <version> <dir>
bun store/admin.ts list <id> <version>
bun store/admin.ts remove <id> <version>
bun store/admin.ts publish <package.pocket> <icon.png> [summary]
```

The store never runs what it holds, and it cannot read a package's source for review: `fetch` and running it on a device are the review. A publish is limited to 16 MiB, 20 a day from one address and 5 versions waiting per key. There is no account system: `dev.pocket-nexus.*` and author names beginning `pocket-nexus`, `omarchy`, `official`, `admin` or `store` belong to the official key.

## What an installed app can reach

The device's own applets hold the owner's X, Discord and Home Assistant sign-ins through the companion services (`daemon/companion.ts`). An app from the store by anyone but the official key runs apart:

| Reach | System apps, official apps, apps built on this device | Apps from the store |
|---|---|---|
| Services | what `applet.services` lists | only `store`, `glyphs`, `maps`, `images`, of what it lists |
| `store` names | shared | its own: names get a prefix from its id, and `/list` is refused |
| The internet, and pictures through `images` | any public address | only the hosts in `applet.hosts`, shown before the install |
| Media streams | 127.0.0.1 | 127.0.0.1 |
| The `appstore` service | the store's own package, from `/usr/share` only | no |

`podcasts` and `youtube` are closed as well: they fetch URLs an app names, which would pass around its declared hosts. The compiler's applet rules run on the publisher's machine, so they prove nothing here; these limits are held by `daemon/appstore.ts` and `daemon/companion.ts` at each request. An app from the store is installed under its whole id, so it cannot stand in for a system app's file. **An app built on the device with `pocket-applet run` is not isolated**: it is the owner's own code, as anything the owner's agent runs in a terminal is.
