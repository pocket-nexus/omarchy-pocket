---
name: pocket-applet
description: Make or change an applet for Omarchy Pocket (the RG DS Plus handheld) with the design system in applets/kit. Use when asked to build a Pocket applet, an Omarchy Pocket app, or to port a client to it, on the device or from a computer.
---

# Making an Omarchy Pocket applet

The rules are in two files. Read both before writing code:

- `sdk/AGENTS.md`: the loop, the rules and the checklist for done.
- `applets/kit/README.md`: the design system. A page is rows; the kit draws them.

`applets/github` is a full client built from the kit, the example to copy.

## On the device

`pocket-applet new <name>` in `~/Applets`, then the loop in `sdk/AGENTS.md`.

## From a computer, in this repository

```
bun tools/build.ts applets <name>                   # .cache/applets/<name>.pocket
bun sdk/check-repo.ts applets/<name>                # the rules pocket-applet check holds an app to
```

Copy the package to the device and open it with `omarchy-shell pocket.window app <path> <title> applet`; the input and screenshot commands are the same over SSH.

## What makes the result bad, in order of how often

1. Drawing pages from `View` and `Text` instead of rows. `pocket-applet check` stops this; do not work around it with the custom-pixels line unless the page is a game, a map or a canvas.
2. Stopping when it compiles. Look at a screenshot of every page, scroll them, tap everything.
3. Testing only the happy path: loading, empty and failed states are pages too.
4. Inventing a palette or icons. The kit has both.
5. Showing what the API returned rather than what a person wants: hashes, ids, ISO dates, nulls.
