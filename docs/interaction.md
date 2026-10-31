# The interaction system

Omarchy Pocket is a Linux desktop shrunk to a handheld: a terminal, a coding agent, an editor and Omarchy's menu on a device that fits a jacket pocket. The RG DS Plus has two panels, a touch surface on the lower one, and a gamepad. The system assigns them in three lines, and every screen on the device follows from those three.

**The stage is the monitor.** The top panel takes no touch. It shows the wallpaper, the current workspace's windows tiled the way Omarchy tiles Hyprland, Omarchy's bar, the card (Omarchy's menu, the bar's panels, the theme picker), the OSD, notices, and the key sheet.

**The deck is the keyboard.** The bottom panel stands in for the keyboard of a computer shrunk to this size, and like a keyboard it changes its layout with what it types into. It has **three layouts**, one **rule** picks them, and nothing else ever puts anything on the deck.

**The gamepad is SUPER.** Omarchy binds every window action to SUPER and one key; here the shoulders are SUPER. L1, R1 and both together are the chord layers, and a layer lasts as long as the shoulder is down. With no shoulder down, the buttons are keys for whatever has focus.

## The deck's layouts

| Layout | What it is | The rule picks it for |
|---|---|---|
| **Keys** | the keyboard: Esc, Tab, Ctrl, Alt and the arrows over four rows of keys (`shell/src/term/keyboard.tsx`) | a terminal, Notes, Activity, Clock, Pictures; the card; a password field |
| **Pad** | a trackpad for the pointer on the stage, with a Hold key (`shell/src/deck/touchpad.tsx`) | a touch app in a window (X, Discord, YouTube, Hacker News) |
| **Home** | the workspaces, the current one's windows and the panels (`shell/src/deck/home.tsx`) | nothing in focus |

The rule (`shell/src/focus.ts`) reads the thing in focus, in this order: a text field that took the keyboard (the lock, a Wi‑Fi password), the card on the stage, the focused window, nothing. The strip along the deck's top names that thing on the left and holds the three layout tabs on the right; the lit tab is the layout shown. A tap on a tab picks a layout by hand; **the choice lasts until the focus changes**, and then the rule picks again. SELECT turns the tabs from the gamepad. The dock along the bottom launches: the menu, a terminal, the agent, the shell's applets, the touch apps.

What the deck never does: it never shows a window's own controls, never mirrors the stage, never keeps a layer or a card after the shoulder or the finger that asked for it is gone.

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

| Held | Layer | D-pad | A | B | X | Y | START | SELECT | L2 / R2 |
|---|---|---|---|---|---|---|---|---|---|
| L1 | window | focus | menu | close | fullscreen | toggle split (dwindle), column width (scrolling) | layout | key sheet | shrink / grow |
| R1 | move | swap | another of this | reopen closed | maximize | swap split (dwindle), stack / unstack (scrolling) | next background | toggle bar | pan the strip |
| L1 + R1 | workspace | ← → switch, ↑ ↓ carry the window | | | | | | | |

**The legend.** A shoulder held for 14 frames (about a quarter second) shows its layer's bindings along the stage's bottom edge, and the bar names the layer from the first frame. Both go with the shoulder. A chord pressed at once never sees the legend. **The key sheet** (L1 + SELECT) puts the whole table over the stage.

Something that cannot happen says why in a notice: "No window that way", "A split needs two windows".

## The stage's card

Omarchy's menu (L1 + A, the dock's first cell, `omarchy-shell shell summon omarchy.menu`), the panels (Network, Audio, Power, Bluetooth, Proxy: a pointer click on the bar's indicator, the home layout's right column, `omarchy-shell shell summon omarchy.network`) and the theme picker open in one 360 × 296 card centred under the bar, and the stage dims behind it. The card has the keys while it is up, so the deck shows the keyboard; a pointer click lands on its rows.

**Sliders answer at once.** A brightness or volume row shows the value the key asked for the frame it is pressed, the OSD shows it on the stage, and one request at a time carries the newest value to omarchy-pocketd; the row reads the device's own value back once the last request has landed. Held or repeated presses accumulate: each step adds to the value shown, not to the value last read.

## The lock

`omarchy-system-lock`, and logind's PrepareForSleep, cover the stage with the clock and give the whole deck to the keyboard with the password field above the keys. omarchy-pocketd checks the password with unix_chkpwd. A is Enter, B Backspace, START clears the field.

## Latency

The device's governors run the shell at their lowest clocks through a single frame of work: schedutil keeps the four Cortex-A55s at 408 MHz when one 60 Hz tick of QuickJS never raises their utilization, and the Mali-G52's simple_ondemand samples every 50 ms and leaves the GPU at 200 MHz, where a panel takes about 15 ms to render against 4 at 800 MHz. The host program keeps **clock floors** instead (`host/src/floor.rs`): it writes each governor's `min_freq` up to the highest clock when input arrives or a frame is presented, and down to the lowest after two seconds without either. Input is seen before the runtime samples it: the runtime's own evdev descriptors are polled for readiness at the top of each tick, so the clocks are up before the guest work the input causes. `/etc/tmpfiles.d/omarchy-pocket-gpu.conf` gives the video group both files.

**A touch acts when the finger lands, not when it lifts.** A key on the deck lights the frame the finger lands (`shell/src/touch.ts` reports a contact from its first frame) and types the frame the contact settles, two frames in, as a hardware key does; the dock, the strip's tabs and the home layout act the same way. Nothing waits on the panel reporting the lift, which the Goodix panel has reported late. A contact lifted before it settles presses nothing: the panel reports brief contacts at a finger's previous position. Backspace and the arrows repeat while held, at most 40 times a press. The pad alone acts on the lift, where a click and a drag part.

The keys and home layouts stay mounted and show by opacity, so a change of focus repaints the deck instead of building a layout. omarchy-pocketd writes the backlights' sysfs files itself and reads one part of the system state back after a change to it, instead of every CLI the whole state runs.
