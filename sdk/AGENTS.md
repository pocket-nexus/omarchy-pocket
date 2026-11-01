# Making a Pocket applet on this device

This directory is one applet for Omarchy Pocket, the Linux handheld you are running on. An applet is a PocketJS package: a Solid app drawn by the device's GPU in a window of the shell, with no browser and no DOM. The compiler, the UI kit and working examples are on this device.

## The loop

Work in this order, and repeat until it looks right:

1. Edit the code in this directory.
2. `pocket-applet run <name>`: compiles (about a minute), installs and opens it in a window, replacing the old one. A compile error prints here; fix it and run again.
3. `pocket-applet shot <name>`: writes `shot.png` here, the device's two panels stacked, windows on the top one. **Look at the image.** Check that the text fits, nothing overlaps and the page does what was asked. Do not call the work done without having looked.
4. `pocket-applet log`: the last lines of the host and the daemon, where an exception from the app or a refused request shows.

Only `pocket-applet publish <name>` sends anything out, and only the owner decides that. Do not run it unless asked.

## What is here

- `app.tsx`, `main.tsx`: the entry. `pocket.json`: the manifest. `icon.svg`: the 128 px icon, a concise picture of what the app is, never letters.
- `../ui/`: the UI kit, read it before writing a widget: `nav.tsx` (pages and the back stack), `table.tsx` (grouped tables), `chrome.tsx`, `field.tsx` (text fields), `alert.tsx`, `slots.ts` (long lists), `touch.ts`, `text.ts` (measuring, wrapping, `ellipsize`).
- `../examples/`: finished applets to copy from. `weather` is a table, a detail page and a search, `hn` a long list with a segmented control, `podcasts` images and media, `maps` gestures and textures, `store` icons and an alert.
- `../lib/net.ts`: `fetch`, `companionService`.
- `../vendor/pocketjs/docs/` and `framework/`: the framework's reference, `docs/HIG.md` for how an app should feel.

## Rules the compiler and the device hold you to

- Import `@pocketjs/framework/*` for components, lifecycle and input, `solid-js` for signals and control flow. There is no DOM, no `window`, no CSS files. Styles are Tailwind-like classes on `View` and `Text`, and every class string must be a whole literal: the compiler bakes them.
- Layout is absolute by default in the kit: compute `insetL`, `insetT`, `width`, `height`. Read `SCREEN_W` and `SCREEN_H` from `../ui/screen.ts` when the page builds. A window can be as small as 320x240 and as large as 640x720, and the app remounts on a resize, so keep state in `keep()` (`../ui/keep.ts`).
- Touch goes through hit targets: a page's `targets()` lists rectangles, and `createTouchRouter` calls them. A `Text` or `View` takes no `onClick`.
- Images are textures with power-of-two sides up to 512. Text is drawn from baked glyphs: `toAscii` a string from the network before drawing it, or use `../ui/glyphs.ts` for anything else.
- The network is `fetch` from `../lib/net.ts`. List every host you fetch in `applet.hosts` in `pocket.json`; once published, the device refuses any other and shows the list before an install. Private addresses are refused.
- Settings outlive the window in the `store` service: `companionService("store", "/get?name=x")`, `/set?name=x` with a JSON body. Add `"store"` to `applet.services`.
- A published app may use the services `store`, `glyphs` and `maps`. `x`, `discord`, `homeassistant`, `podcasts` and `youtube` are for the device's own applets.
- QuickJS runs the code: there is no `TextDecoder`, `setTimeout` is `after()` from `@pocketjs/framework/clock`, and a frame is 16 ms, so do not do per-frame work in signals you can avoid.
- The deck's keyboard types into a field: see `SearchField` in `../ui/field.tsx` and how `examples/weather/app.tsx` uses `createOsk`.

## Before saying it is done

Run it, take a shot, look at it, try the page the request is about, and read `pocket-applet log` for errors.
