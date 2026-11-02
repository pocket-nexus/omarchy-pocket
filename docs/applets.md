# Making and publishing applets

An applet is a PocketJS package in a window of the shell. The applets live in [pocket-nexus/applets](https://github.com/pocket-nexus/applets), a submodule here at `vendor/applets`, which builds each of them for every device that runs it, and the store at `applets.pocket.nexus` carries them. `bun tools/build.ts applets` builds the ones this device ships for its host contract into `.cache/applets`. The toolchain to make one runs on the device.

## Making one on the device

**Apps › Make an Applet** asks what the applet should do and starts Codex on it in `~/Applets/<name>`. The same steps by hand, in a terminal or from any coding agent:

| Command | What it does |
|---|---|
| `pocket-applet new <name>` | a new applet from the applets repository's `template/`, with `AGENTS.md` beside it |
| `pocket-applet check <name>` | the rules below, each with what to do instead; `run` and `build` stop on an error, `publish` also on a warning |
| `pocket-applet run <name>` | compiles, installs to `~/.local/share/omarchy-pocket/applets/` and opens the window, replacing a running one |
| `pocket-applet shot <name>` | both panels as `<name>/shot.png`, for the agent to look at |
| `pocket-applet log` | the last lines of the host and the daemon |
| `pocket-applet tap <x> <y>`, `scroll`, `key`, `type` | input to the shell, so an agent can open each page it made |
| `pocket-applet mock <name>` | packs its sample data (`mock/mock.json`) and says what it holds |
| `pocket-applet web <name> [--port 4310]` | serves it on its sample data, as the store's page runs it, to a browser on the network |
| `pocket-applet publish <name> --author <handle>` | signs it and sends it to the store, with its sample data |

`~/Applets` is laid out as pocket-nexus/applets is, with symlinks into the SDK at `/usr/share/omarchy-pocket/sdk`: `ui`, `lib`, `kit`, `vendor`, `host`, `node_modules`, and `examples` (the applets repository's subset the SDK carries, at `vendor/applets`). `sdk/AGENTS.md` is what the agent reads. `bun tools/build.ts sdk` builds the SDK (89 MiB, installed for linux-arm64) and `bun tools/deploy.ts <host> sdk` installs it.

**An app is built from the design system in the applets repository's `kit/`** (`kit/README.md`): a page is a list of rows, and the kit does the measuring, colours, touch, keyboard focus, loading states and text for any script. `github/` is a full client built that way. Its `tools/check.ts` refuses a page of positioned views, a colour of its own, a host or a service missing from the manifest, a query with no failure state, an emoji and an icon of letters; a file that draws a game or a map names why on its first lines and keeps its own pixels. `sdk/AGENTS.md` is what a coding agent on the device reads; the applets repository's `skills/pocket-applet/SKILL.md` is the same for one on a computer.

**Measured on the device:** a full compile of Weather takes 62 s and peaks at 386 MiB of 953 MiB, about 35 s of it the TypeScript check. No Rust toolchain is involved: a package is JavaScript, styles, fonts and images.

## The network, the store and sample data

**An applet's network is its worker domain.** The host runs each windowed app's worker (`pocket-linux-worker`); the worker's `http` node hands every request to the shell's thread (`host/src/net.rs`), which carries it to omarchy-pocketd as an `appNet` bridge line, and the daemon performs it: the companion services (`daemon/companion.ts`) on this device, any other URL fetched, within what the app's package may reach (`daemon/appstore.ts`). An answer comes back as the worker's facts: its headers, its body in 1 KiB blocks, its end. **The host contract states the worker table** (`host/pocket.host.json` `worker`): a channel of up to **64 records of 16 KiB**, which the applets' response ring takes (`"host"` in their app contracts), and responses of up to **4 MiB** (`worker.http.responseBytes`), which the host's http node and the daemon hold an app to. The UI drains the ring once a frame, so an answer moves up to 1 MiB a frame; on a host that states no table it is 8 KiB. One response holds a density-2 atlas of the glyphs a page shows, so the applets ask for glyph atlases at the surface's density 2.

The store, the publishing rules, sample data, the browser player and what an app from the store can reach are described in the applets repository's [docs/applets.md](https://github.com/pocket-nexus/applets/blob/main/docs/applets.md). The device's Store applet reads `applets.pocket.nexus/v1/catalog` for this device's profile and installs a package with a variant built for it.
