# The interaction system

Omarchy Pocket is a Linux desktop shrunk to a handheld: a terminal, a coding agent, an editor and Omarchy's menu on a device that fits a jacket pocket. The RG DS Plus has two panels, a touch surface on the lower one, and a gamepad. The system assigns them in three lines, and every screen on the device follows from those three.

**The stage is the monitor.** The top panel takes no touch. It shows the wallpaper, the current workspace's windows tiled the way Omarchy tiles Hyprland, Omarchy's bar, the card (Omarchy's menu, the bar's panels, the theme picker), the OSD, notices, and the key sheet.

**The deck is the keyboard.** The bottom panel stands in for the keyboard of a computer shrunk to this size, and like a keyboard it changes its layout with what it types into. It has **three layouts**, one **rule** picks them, and nothing else ever puts anything on the deck.

**The gamepad is SUPER.** Omarchy binds every window action to SUPER and one key; here the shoulders are SUPER. L1, R1 and both together are the chord layers, and a layer lasts as long as the shoulder is down. With no shoulder down, the buttons are keys for whatever has focus.

## The deck's layouts

| Layout | What it is | The rule picks it for |
|---|---|---|
| **Keys** | four rows of keys with Return on the home row, Ctrl, Alt and the arrows on the bottom row (`shell/src/term/keyboard.tsx`), and the trackpad under them (`shell/src/deck/touchpad.tsx`) | a terminal, Notes, Activity, Clock, Pictures; the card; a password field |
| **Pad** | the keys fold away and the same trackpad takes their room | a touch app in a window (X, Discord, YouTube, Hacker News) |
| **Home** | the workspaces and the layout badge on the left, the current workspace's windows at 0.7 in the middle, the bar's panels on the right, the pinned apps along the bottom (`shell/src/deck/home.tsx`) | nothing in focus |

The rule (`shell/src/focus.ts`) reads the thing in focus, in this order: a text field that took the keyboard (the lock, a Wi‑Fi password), the card on the stage, the focused window, nothing. **The function row** along the hinge (`shell/src/deck/strip.tsx`) stays in every layout: Omarchy's logo (a press opens the menu, as L1 + A does), Esc, the keys what has focus wants at one press, and Home. A terminal gets Tab, ^C, ^D, ^L and ^R; a touch app gets Back, which it hears as the Cross button; other windows get Tab; an empty workspace gets Layout; the menu gets Pin or Unpin for the app it has selected. The row has no workspace steps: Home's left column switches workspaces. **Four round buttons** sit at the bottom of the trackpad's margins, two a side at one height, and stay put when it grows: the microphone and Hold on the left, the keyboard and Close on the right. Close shuts what is in front: the key sheet or a card when one is up, else the focused window, as L1 + B does, so an applet closes with one press; a terminal's window closes the same way, and the function row's × is for a text field. The key sheet is L1 + SELECT. An icon is placed by its ink, not its advance: a Nerd Font icon is wider than JetBrains Mono's 0.6 em advance, so `shell/src/ink.ts` moves each one left by the offset `tools/omarchy-assets.ts` measures from the fonts. The keyboard button and Home pick a layout by hand; **the choice lasts until the focus changes**, and then the rule picks again. SELECT turns the layouts from the gamepad. Launching is the menu's Apps list (type to filter: Terminal, Agent, the shell's applets, the touch apps, then the terminal programs) and **Home's pins**: up to six app icons under the map, no labels, one press each, with a last cell that opens the menu at Apps. In the menu, Y or the function row's Pin pins or unpins the selected app, and a pinned row ends with a pin. A pin opens its app as its Apps row does; a package already open in a window is focused instead. omarchy-pocketd keeps the list in `~/.local/state/omarchy-pocket/pins.json` (`daemon/pins.ts`); until something is pinned or unpinned Home shows Terminal, Agent, YouTube, X, GitHub and Weather, those the device has.

What the deck never does: it never shows a window's own controls, never mirrors the stage, never keeps a layer or a card after the shoulder or the finger that asked for it is gone.

## Voice input

The round microphone button opens the RK817's main microphone; the next press closes it, and the words type into what has the keys. A touch app with no field open shows them in a notice. **Recognition runs on the device with no network and no open port**: `daemon/voice.ts` records through `arecord` and sends the samples over a pipe to `pocket-asr` (`daemon/asr/pocket-asr.c`), which holds sherpa-onnx's 80 MB `paraformer-zh-small` model for Mandarin and English. The recognizer takes **157 MB of RSS**, starts with the first recording and exits 5 minutes after the last. The capture path is off except during a recording, and a recording ends at 60 s. `bun tools/build.ts asr` gathers the runtime and the model; `bun tools/deploy.ts <host> asr` installs them.

## Keys

One keyboard, two ways to type it. The deck types by touch. The gamepad with no shoulder down types the keys a thumb reaches without looking (`shell/src/keys.ts`):

| Button | Key |
|---|---|
| D-pad | the arrows |
| A | Enter |
| B | Backspace |
| X | Tab |
| Y | Space |
| START | Escape |
| SELECT | the next deck layout |
| L2 / R2 | the previous and next workspace |

Both end in the same place, the **key sink** of what has focus:

- **A terminal** gets characters as text and named keys as keys, which omarchy-pocketd encodes against the terminal's modes. Ctrl and Alt on the deck latch for the next key: Ctrl, then C, sends ^C.
- **The card** takes the arrows, Enter and Escape; the menu also takes typing, which filters the level's rows by their labels as Omarchy's walker menu does, with Backspace taking a character back and then a level, and Escape clearing the filter and then closing the menu. A panel's Left and Right move its sliders.
- **Notes** takes text while a note is open, with pinyin through the 中 key; with the list showing, the arrows pick a note and Enter opens it.
- **Activity, Clock and Pictures** take the keys that stand for buttons: the arrows, Enter, Tab. Each says what they do on the line above the keys.
- **A touch app** (a PocketJS applet in a window) takes no keys: its touches come from the pad's pointer.
- **Any other package** (a game) gets the buttons the window manager does not take, each frame.

The line above the keys names the thing in focus and what the keys do there, and carries the close button for a terminal or a note.

## The pad

A finger moves the pointer on the stage, relative and accelerated, as a laptop's trackpad does. A tap clicks where the pointer is: a touch on an applet's surface at that point, a card's row, a workspace number or an indicator on the bar, a window to focus it. Two fingers scroll: the pointer stays and the list under it moves with the fingers. The Hold key and a finger drag. A package that draws a touch surface of its own and is not a touch app shows that surface on the pad instead, and the fingers on it are its contacts.

## Chords

The chord table is `shell/src/chords.ts`, after Pocket Shell's 3DS shell. The dispatcher, the legend and the key sheet read the one table.

| Held | Layer | D-pad | A | B | X | Y | START | SELECT | L2 / R2 | Sticks |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 | window | focus | menu | close | fullscreen | toggle split (dwindle), column width (scrolling) | layout | key sheet | shrink / grow | |
| R1 | move | swap | open another | reopen closed | maximize | swap split (dwindle), (un)stack (scrolling) | next wallpaper | toggle bar | pan the strip | resize |
| L1 + R1 | workspace | ← → switch, ↑ ↓ carry the window | | | | | | | | |

**The sticks.** Under R1 either stick resizes the focused window as it is pushed (`shell/src/stick.ts`): right and left make it wider and narrower, up and down taller and shorter. In dwindle the nearest split across that direction moves by 0.05; in scrolling the column's width changes. A push past 0.35 takes one step at once and another every 14 frames, down to every 4 at a full push. The host reads the sticks from `ABS_Z`, `ABS_RX`, `ABS_RY` and `ABS_RZ` (the stock SDL entry's a0 to a3), through pocketjs's evdev decoder (`set_sticks`, pocketjs `ccf0853d`). `omarchy-shell pocket.input stick <x> <y> [frames]` stands in for a stick over SSH.

**The legend.** A shoulder held for 14 frames (about a quarter second) shows its layer's bindings along the stage's bottom edge, three to a row, and the bar names the layer from the first frame. Both go with the shoulder. A chord pressed at once never sees the legend. **The key sheet** (L1 + SELECT) puts the whole table over the stage.

Something that cannot happen says why in a notice: "No window that way", "A split needs two windows".

## The stage's card

Omarchy's menu (L1 + A, the function row's logo, `omarchy-shell shell summon omarchy.menu`), the panels (Network, Audio, Power, Bluetooth, Proxy: a pointer click on the bar's indicator, the home layout's right column, `omarchy-shell shell summon omarchy.network`) and the theme picker open in one 360 × 296 card centred under the bar, and the stage dims behind it. The card has the keys while it is up, so the deck shows the keyboard; a pointer click lands on its rows.

**Sliders answer at once.** A brightness or volume row shows the value the key asked for the frame it is pressed, the OSD shows it on the stage, and one request at a time carries the newest value to omarchy-pocketd; the row reads the device's own value back once the last request has landed. Held or repeated presses accumulate: each step adds to the value shown, not to the value last read.

## The lock

`omarchy-system-lock`, and logind's PrepareForSleep, cover the stage with the clock and give the whole deck to the keyboard with the password field above the keys. omarchy-pocketd checks the password with unix_chkpwd. A is Enter, B Backspace, START clears the field.

## Latency

The device's governors run the shell at their lowest clocks through a single frame of work: schedutil keeps the four Cortex-A55s at 408 MHz when one 60 Hz tick of QuickJS never raises their utilization, and the Mali-G52's simple_ondemand samples every 50 ms and leaves the GPU at 200 MHz, where a panel takes about 15 ms to render against 4 at 800 MHz. The host program keeps **clock floors** instead (`host/src/floor.rs`): it writes each governor's `min_freq` up to the highest clock when input arrives or a frame is presented, and down to the lowest after two seconds without either. Input is seen before the runtime samples it: the runtime's own evdev descriptors are polled for readiness at the top of each tick, so the clocks are up before the guest work the input causes. The Power panel's profile shapes the floors: **performance** keeps them up, **balanced** is the rule above, **power-saver** caps both governors at the highest clock within 56% of the top (1.1 GHz, 400 MHz). `/etc/tmpfiles.d/omarchy-pocket-gpu.conf` gives the video group the four files.

**A touch acts when the finger lands, not when it lifts.** A key on the deck lights the frame the finger lands (`shell/src/touch.ts` reports a contact from its first frame) and types the frame the contact settles, two frames in, as a hardware key does; the strip and the home layout act the same way. Nothing waits on the panel reporting the lift, which the Goodix panel has reported late. A contact lifted before it settles presses nothing: the panel reports brief contacts at a finger's previous position. Backspace and the arrows repeat while held, at most 40 times a press. The pad alone acts on the lift, where a click and a drag part.

The keys and home layouts stay mounted and show by opacity, so a change of focus repaints the deck instead of building a layout. omarchy-pocketd writes the backlights' sysfs files itself and reads one part of the system state back after a change to it, instead of every CLI the whole state runs.
