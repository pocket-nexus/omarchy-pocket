#!/usr/bin/bash
# The Linux environment's first process on the Android handhelds. The app
# (android/app's LinuxService) runs it under proot as the Omarchy user, from
# a login shell, so it has Omarchy's environment (/etc/profile.d/omarchy.sh),
# as the RG DS Plus's omarchy-pocketd.service does. It puts up the session
# bus omarchy-pocketd's notifications and notify-send use, sets Omarchy's
# theme on the first start, then becomes omarchy-pocketd. The app restarts
# it when it exits.
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR/omarchy-pocket"
chmod 700 "$XDG_RUNTIME_DIR"

if command -v dbus-daemon >/dev/null; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  rm -f "$XDG_RUNTIME_DIR/bus"
  dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --nofork --nopidfile --nosyslog >/dev/null 2>&1 &
fi

# the image leaves the theme to the first login: the shell's palette and
# wallpaper come from ~/.local/state/omarchy/current
if [ ! -e "$HOME/.local/state/omarchy/current/theme.name" ]; then
  omarchy-theme-set tokyo-night >/dev/null 2>&1 || true
fi

cd "$HOME"
exec /usr/bin/bun /usr/lib/omarchy-pocket/omarchy-pocketd.js
