# Making a Pocket applet on this device

This directory is one applet for Omarchy Pocket, the Linux handheld you are running on. An applet is a PocketJS package: a Solid app drawn by the device's GPU in a window of the shell, with no browser and no DOM.

**Build it from the design system in `../kit`.** A page says what it shows, as rows, and the kit draws it. **Read `../kit/README.md` before writing anything**, then copy from `../examples/github`, a full app built the same way. An app of positioned views looks bad however long you work on it, and `pocket-applet check` refuses one.

## The loop

Repeat until every page looks right:

1. Edit the code in this directory.
2. `pocket-applet run <name>`: checks the rules, compiles (about a minute), installs and opens it in a window, replacing the old one. Fix what it prints and run again.
3. `pocket-applet shot <name>`: writes `shot.png` here, the device's two panels stacked, windows on the top one. **Open the image and look at it.**
4. `pocket-applet log`: the host's and the daemon's last lines. An exception from the app shows as `app N threw: ...`.
5. Use it as a person would. `pocket-applet tap <x> <y>` clicks at a place read off the top panel of the shot (1024 x 768, so a row at y = 400 in the image is tapped at y = 400). `pocket-applet scroll <x> <y> <dy>` scrolls what is there, up by dy. `pocket-applet key Enter|Backspace|Up|Down` (Backspace goes back), `pocket-applet type <text>`. Wait for the network before the next shot: `sleep 3`.

## Plan the pages first

Write the list of pages at the top of `app.tsx` before the code, with what each one shows and which row each thing is. One thing per page. The first page shows the reader's data.

## Rules

- Only `../kit`, `../lib/net.ts`, `../ui/window.tsx`, `../ui/keep.ts`, `solid-js` and `@pocketjs/framework/clock` are for app pages. `pocket-applet check` prints what to use instead of anything else.
- **No colours, sizes or positions of your own.** No `View`, `Text` or `Image`. A game, a map or a canvas is the one exception: see the end of the kit's README.
- **The network is `fetch` from `../lib/net.ts`, inside a query** (`app.queries.query`, `app.queries.paged`). QuickJS runs the code: there is no `TextDecoder`, no timers (`after()` from `@pocketjs/framework/clock`), no DOM. List every host in `applet.hosts` in `pocket.json`; once published, the device refuses any other.
- Settings outlive the window in the `store` service: `fetch(companionService("store", "/get?name=x"))`, `/set?name=x` with a JSON body. Pictures are `avatar:` on a cell. `manifest.applet.services` lists what you use; a published app may use `store`, `glyphs`, `maps` and `images`.
- `pocket.json`: set `applet.summary` to one line saying what the app does. `icon.svg`: 128 px, a concise picture of what the app is, never letters.
- **Never send anything to a real service while testing:** no comments, posts, merges or other writes unless the owner asks for that one. Read-only requests are fine. Keep a sign-in token out of the code; ask for it with `app.compose({ secret: true })` and keep it in the store service.
- Only `pocket-applet publish <name>` sends the app out, and only the owner decides that. Do not run it unless asked.

## Before saying it is done

Go through this for **every page**, with a shot of each, and fix what fails:

- [ ] `pocket-applet check <name>` prints nothing.
- [ ] `pocket-applet log` shows no `threw`.
- [ ] Every button and row in the request does what it says. You tapped it.
- [ ] Real data shows, from the real source, with no placeholder or template text left.
- [ ] A long list scrolls, and more than one screen of it looks right.
- [ ] No text is cut in the middle of a word, overlapping or running off the window. Long values and non-English text were tried.
- [ ] No `undefined`, `null`, `[object Object]`, JSON, raw ids or ISO dates on screen.
- [ ] Loading, empty and failed each show something a person can read and act on. Turn the failure on by pointing the request at a bad path once, look, and put it back.
- [ ] Back returns to where you were, at the same scroll position.
- [ ] The summary and the icon say what the app is.

Say in your last message which pages you looked at and what you could not check.
