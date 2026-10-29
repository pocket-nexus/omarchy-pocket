# Omarchy features in Omarchy Pocket

Omarchy's desktop is Hyprland plus a Quickshell shell (`/usr/share/omarchy/shell`: the bar, the menu and about 30 plugins). Omarchy Pocket keeps Omarchy's CLI, config, themes and services and replaces the desktop with its PocketJS shell. This table lists each part of Omarchy's desktop and its state on the RG DS Plus. **Done** means it ran on the device; the date is the last check.

| Omarchy part | Omarchy Pocket | State |
|---|---|---|
| Menu (`omarchy-menu.jsonc`, `omarchy.menu` plugin) | the deck: Omarchy's tree, `when`/`checked`/`disabled` from the daemon, actions through the daemon, `shell summon omarchy.menu {"menu":…}` | done 2026-10-29 |
| System › Lock | `omarchy-system-lock` → `lock lock` → clock on the stage, password on the touch keyboard (A Enter, B Backspace); omarchy-pocketd checks it with `unix_chkpwd`. The shell also locks on logind's `PrepareForSleep`, as hypridle's `before_sleep_cmd` does | done 2026-10-29 (wrong password refused, right one unlocks, locked after an RTC-timed suspend) |
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
| Theme backgrounds (`background` plugin, `omarchy-theme-bg-set`) | `background set|transition|themeTransition`: omarchy-pocketd scales Omarchy's current background with vipsthumbnail (shrink-on-load, about 1.1 s for an 8192 × 4608 WebP) into four RGBA tiles; the host uploads them as textures | done 2026-10-29 |
| Appearance › Theme (`omarchy.image-picker`, source themes) | deck list of `omarchy-theme-switcher` rows with Omarchy's labels, the highlighted theme's preview as the wallpaper; A runs `omarchy-theme-set` | done 2026-10-29 (Lupine: light palette and background) |
| Appearance › Background and other image menus (`image-selector open`) | the same picker; A writes the selection file and the done file `omarchy-menu-images` waits on | done 2026-10-29 |
| Notifications (`notifications` plugin, D-Bus `org.freedesktop.Notifications`) | omarchy-pocketd owns the name on the user's bus (dbus-next); notices in the stage's top-right corner with Omarchy's glyph hint, critical in red; Y runs `omarchy-exec-argv` or the first action, X dismisses; 5 s default expiry, critical stays | done 2026-10-29; no notification history view yet |
| Terminal (Alacritty/foot/kitty under Hyprland) | Pocket Term: PTYs in omarchy-pocketd (Bun.Terminal + libghostty), 80×26 grid on the top panel, touch keyboard and gamepad keys on the bottom; `xdg-terminal-exec` opens it, so the 147 menu actions that run `omarchy-launch-floating-terminal-with-presentation` land there | done 2026-10-29 (fastfetch, btop, Omarchy's bash, Chinese output) |
| Text beyond the baked ranges (CJK, Cyrillic, Latin Extended) | omarchy-pocketd bakes the characters the shell meets (terminal cells, menu labels, candidates) from wqy-microhei with PocketJS's `bakeSlot` into font slots 21 (12 px) and 22 (14 px); the host loads each atlas file with `loadFontAtlas` | done 2026-10-29 (terminal, Language list); Arabic, Bengali and other scripts wqy-microhei lacks show boxes |
| Text input, IME (fcitx5) | the touch keyboard (terminal, lock, Wi-Fi password) with a 中/EN key: pinyin through PocketJS's Rime engine (`tools/ime/rime.c` as `pocket-rime`, the `pocket_pinyin` schema over Luna Pinyin) in omarchy-pocketd; preedit and five candidates in the strip above the keys, Space or a digit picks, Enter commits the letters, A picks the first | done 2026-10-29 (`echo 你好世界`, 中文 into Pocket Term) |
| Bar indicator panels (`panels/network`, `audio`, `power`, `bluetooth`) | the deck: R2 or `shell summon omarchy.network|audio|power|bluetooth`; L1/R1 move between them, the bar marks the open one. Network: Wi-Fi on/off, scan, connect (password on the touch keyboard), disconnect, forget. Audio: output and input volume and mute, default device (Speakers, Headphones, Microphone). Power: battery, brightness of both panels, power profile | done 2026-10-29 (volume, brightness, network list; connecting to another network not run: it would cut the device's link) |
| Bluetooth | `rgds-bluetooth.service` brings the RTL8821CS's UART Bluetooth up at boot (rfkill power cycle, `hci_uart`, the stock `rtk_hciattach … rtk_h5` on `/dev/ttyS1`); the panel powers it, scans for 8 s, pairs Just Works, connects, disconnects and forgets; unnamed devices stay hidden unless paired, as in Omarchy's model | adapter, power and scan done 2026-10-29; pairing not run (no device in pairing mode nearby) |
| Setup menu (Omarchy's rows: DNS, defaults, plugins, security, config, language) | Omarchy's rows run through the daemon; terminal ones open in Pocket Term | rows not run one by one yet |
| Install / Remove / Update | terminal TUIs in Pocket Term | not yet run on the device |
| Menu providers (Apps, Font, Language, Kernel, power profiles) | Omarchy's provider one-liners (`label\tvalue\tcurrent`, plugins/menu/Menu.qml) on the deck, the current value checked; Apps lists the desktop entries that run in a terminal (btop, Neovim, Vim) and starts them in Pocket Term | done 2026-10-29 (Apps, Language); kernel list empty on the stock kernel |
| Apps (`dock` plugin, graphical apps) | graphical apps need a compositor | PocketJS applets planned |
| Trigger › Capture › Screenshot (`omarchy-capture-screenshot` → `omasnap`) | `omasnap` (daemon/shim.ts) reads both panels back from the GPU, writes a 1024 × 1536 PNG to `~/Pictures` with vips and sends Omarchy's notification | done 2026-10-29; no clipboard copy (no Wayland clipboard) |
| Trigger › screen recording, text, QR, color picker | Wayland tools | not planned |
| Learn (web apps) | no browser without a compositor | not planned |
| Clipboard, emojis, reminders, agents, image picker | — | planned after the keyboard |
