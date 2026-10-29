# Omarchy features in Omarchy Pocket

Omarchy's desktop is Hyprland plus a Quickshell shell (`/usr/share/omarchy/shell`: the bar, the menu and about 30 plugins). Omarchy Pocket keeps Omarchy's CLI, config, themes and services and replaces the desktop with its PocketJS shell. This table lists each part of Omarchy's desktop and its state on the RG DS Plus. **Done** means it ran on the device; the date is the last check.

| Omarchy part | Omarchy Pocket | State |
|---|---|---|
| Menu (`omarchy-menu.jsonc`, `omarchy.menu` plugin) | the deck: Omarchy's tree, `when`/`checked`/`disabled` from the daemon, actions through the daemon, `shell summon omarchy.menu {"menu":…}` | done 2026-10-29 |
| System › Lock | `omarchy-system-lock` → `lock lock` → lock screen on both panels; hold A unlocks | done 2026-10-29; password unlock waits for the on-screen keyboard |
| System › Suspend | `systemctl suspend` from the user's session | done 2026-10-29 (deep suspend, RTC wake) |
| System › Hibernate | hidden by its `when`: no swap to resume from | — |
| System › Logout | `omarchy-system logout` → `uwsm stop` shim → new session | done 2026-10-29 |
| System › Reboot | `omarchy-system reboot` | done 2026-10-29 |
| System › Shutdown | `omarchy-system shutdown`; logind answers `CanPowerOff=yes` | not run (no remote power-on) |
| System › Screensaver | `omarchy-launch-screensaver` needs Hyprland to place its window | planned |
| OSD (`omarchy-osd`, `osd` plugin) | stage overlay with Omarchy's `OsdModel.js` | done 2026-10-29 |
| Bar: clock, indicators | clock; Bluetooth, network, audio, battery glyphs from SystemState via Omarchy's panel models | done 2026-10-29 (Bluetooth absent: the adapter is not attached yet) |
| Bar: workspaces | five static workspaces, L2/R2 select | no windows to place on them |
| Theme colours (`omarchy-theme-set` → `shell applyTheme`) | run-time palette | done 2026-10-29 (Catppuccin, Gruvbox, Tokyo Night) |
| Theme backgrounds (`background` plugin) | wallpaper tiles baked into the package | run-time backgrounds planned |
| Notifications (`notifications` plugin, D-Bus `org.freedesktop.Notifications`) | omarchy-pocketd owns the name on the user's bus (dbus-next); notices in the stage's top-right corner with Omarchy's glyph hint, critical in red; Y runs `omarchy-exec-argv` or the first action, X dismisses; 5 s default expiry, critical stays | done 2026-10-29; no notification history view yet |
| Terminal (Alacritty/foot/kitty under Hyprland) | Pocket Term: PTYs in omarchy-pocketd (Bun.Terminal + libghostty), 80×26 grid on the top panel, touch keyboard and gamepad keys on the bottom; `xdg-terminal-exec` opens it, so the 147 menu actions that run `omarchy-launch-floating-terminal-with-presentation` land there | done 2026-10-29 (fastfetch, btop, Omarchy's bash); wide characters show as `??` until runtime glyphs |
| Text input, IME (fcitx5) | — | on-screen keyboard and pinyin planned |
| Setup (Wi-Fi, Bluetooth, audio, power, display, timezone panels) | — | planned |
| Install / Remove / Update | terminal TUIs in Pocket Term | not yet run on the device |
| Apps (`dock` plugin, app launcher) | — | planned: PocketJS applets |
| Trigger (screenshot, screen recording, share) | — | screenshot planned through the GPU readback |
| Learn (web apps) | no browser without a compositor | not planned |
| Clipboard, emojis, reminders, agents, image picker | — | planned after the keyboard |
