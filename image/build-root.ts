#!/usr/bin/env bun
// Builds the Omarchy Pocket root for the RG DS Plus in an arm64 container
// (OrbStack on the Mac) and exports it to .cache/rgds-root.tar.zst for
// install.ts: Arch Linux ARM with Omarchy's CLI, themes, config and services,
// without Omarchy's desktop session (the PocketJS shell draws the UI).
//
//   bun image/build-root.ts [--from <step>] [--only <step>] [--user <name>]
//
// Steps run in order inside the long-lived container `rgds-root`, so a failed
// step can be fixed and resumed with --from. Input:
// .cache/ArchLinuxARM-aarch64-latest.tar.gz from os.archlinuxarm.org.
import { $ } from "bun";
import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const CACHE = join(REPO, ".cache");
const IMAGE = "alarm:2026-08";
const CONTAINER = "rgds-root";
const PROXY = process.env.RGDS_PROXY ?? "http://host.docker.internal:7897";
const OMARCHY_KEY = "40DFB630FF42BCFFB047046CF0134EE680CAC571";
// rc carries omarchy 4.5.0rc2, the first with the aarch64 platform tooling
// (omarchy-pkg-defaults, omarchy-hw-platform, image manifests); stable is 4.0.6.
const CHANNEL = "rc";

type Step = { name: string; script: (o: Options) => string };
type Options = { user: string };

// Omarchy's default/pacman/aarch64 template for CHANNEL, written before the
// omarchy package exists to provide it; omarchy-apply-system installs its own.
const BOOTSTRAP_PACMAN = `[options]
HoldPkg = pacman glibc
Architecture = auto
CheckSpace
ParallelDownloads = 5
DisableSandbox
SigLevel = Required DatabaseOptional
LocalFileSigLevel = Optional
[omarchy]
Server = https://pkgs.omarchy.org/${CHANNEL}/$arch
[core]
Include = /etc/pacman.d/mirrorlist
[extra]
Include = /etc/pacman.d/mirrorlist
[alarm]
Include = /etc/pacman.d/mirrorlist
`;

// Omarchy's CLI tools and the services its install enables (install/config/
// enable-services.sh, install/hardware/bluetooth.sh) minus printing, Docker and
// the display manager. The omarchy package itself pulls NetworkManager,
// PipeWire, WirePlumber, gum, jq and git.
const PACKAGES = [
  "omarchy", "omarchy-settings",
  "bluez", "bluez-utils", "alsa-utils", "brightnessctl", "pamixer", "avahi", "nss-mdns",
  "omarchy-power-profiles-daemon", "zram-generator", "rtkit", "tzupdate", "wireless-regdb",
  "openssh", "sudo", "python", "less", "man-db", "bash-completion", "bat", "btop", "eza",
  "fd", "fzf", "ripgrep", "starship", "tmux", "zoxide", "tldr", "unzip", "whois",
  "inetutils", "fastfetch", "plocate", "neovim",
  // omarchy-pocketd and its shims run on Bun; omarchy-shell needs socat for its
  // socket; powerprofilesctl imports gi
  "bun-bin", "socat", "python-gobject",
  // PipeWire's ALSA, Pulse and BlueZ plugins (WirePlumber finds no sound card
  // without pipewire-audio); the tools Omarchy's menus run
  "pipewire-audio", "pipewire-alsa", "pipewire-pulse", "expac", "yay", "xdg-terminal-exec",
  "bluez-tools", "qrencode", "inotify-tools",
  // backgrounds: vipsthumbnail as in Omarchy's omarchy-menu-images; magick for omarchy-bar-text-color
  "libvips", "imagemagick",
];

const steps: Step[] = [
  {
    name: "pacman",
    script: () => `
cat > /etc/pacman.conf <<'EOF'
${BOOTSTRAP_PACMAN}EOF
echo 'Server = https://arm-${CHANNEL}-mirror.omarchy.org/$arch/$repo' > /etc/pacman.d/mirrorlist
pacman-key --init
pacman-key --populate archlinuxarm
# keys.openpgp.org does not answer from this network; keyserver.ubuntu.com does
curl -fsSL 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x${OMARCHY_KEY}' -o /tmp/omarchy.asc
pacman-key --add /tmp/omarchy.asc
pacman-key --lsign-key ${OMARCHY_KEY}
# the stock Rockchip kernel and its firmware stay on the device
pacman -Rdd --noconfirm linux-aarch64 $(pacman -Qq | grep '^linux-firmware') || true
pacman -Syu --noconfirm
pacman -S --noconfirm --needed omarchy-keyring`,
  },
  {
    name: "headless",
    script: () => `
pacman -S --noconfirm --needed base-devel
id builder >/dev/null 2>&1 || useradd -m builder
rm -rf /home/builder/headless && cp -r /repo/pkg/omarchy-pocket-headless /home/builder/headless && chown -R builder /home/builder/headless
su builder -c 'cd /home/builder/headless && PKGEXT=.pkg.tar.zst makepkg -f --noconfirm'
pacman -U --noconfirm /home/builder/headless/omarchy-pocket-headless-*.pkg.tar.zst`,
  },
  {
    name: "packages",
    script: () => `
pacman -S --noconfirm --needed ${PACKAGES.join(" ")}
pacman -Q omarchy omarchy-settings omarchy-pocket-headless
for p in hyprland quickshell uwsm sddm; do
  if pacman -Qq "$p" 2>/dev/null | grep -qx "$p"; then echo "$p was installed"; exit 1; fi
done
rm -rf /var/cache/pacman/pkg/*`,
  },
  {
    name: "user",
    script: ({ user }) => `
id ${user} >/dev/null 2>&1 || useradd -m -G wheel,video,input,audio -s /bin/bash ${user}
echo '${user}:${user}' | chpasswd
echo 'root:root' | chpasswd
echo '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/10-wheel
chmod 440 /etc/sudoers.d/10-wheel`,
  },
  {
    name: "device",
    script: ({ user }) => `
cp -a /repo/device/rootfs/. /
sed -i 's/^User=omarchy$/User=${user}/' /usr/lib/systemd/system/omarchy-pocket.service
install -Dm755 /repo/tools/usb-link/usbmux.py /usr/lib/pocket-rgds/usbmux.py
# the shell: tools/build.ts builds the host program, the package, omarchy-pocketd and its shims
install -Dm755 /repo/.cache/host/cargo/aarch64-unknown-linux-gnu/release/omarchy-pocket-host /usr/bin/omarchy-pocket-host
install -Dm644 /repo/.cache/shell/omarchy-pocket.pocket /usr/share/pocketjs/omarchy-pocket.pocket
install -Dm644 /repo/.cache/daemon/omarchy-pocketd.js /usr/lib/omarchy-pocket/omarchy-pocketd.js
install -Dm644 /repo/.cache/daemon/ghostty-vt.wasm /usr/lib/omarchy-pocket/ghostty-vt.wasm
for name in hyprctl uwsm uwsm-app omarchy-pocket-term omasnap; do install -Dm755 /repo/.cache/daemon/shim.js /usr/local/bin/$name; done
install -d -m 755 /usr/lib/mali
install -m 755 /repo/.cache/blobs/libmali.so.1.9.0 /repo/.cache/blobs/libmali-hook.so.1.9.0 /usr/lib/mali/
ln -sf libmali.so.1.9.0 /usr/lib/mali/libmali.so.1
ln -sf libmali-hook.so.1.9.0 /usr/lib/mali/libmali-hook.so.1
ldconfig
ldd /usr/bin/omarchy-pocket-host | grep -q 'libmali.so.1 => /usr/lib/mali/libmali.so.1'
# Omarchy's own install step: Arch Linux ARM's tarball ships LANG=C
bash /usr/share/omarchy/install/config/locale.sh
timedatectl set-timezone Asia/Shanghai 2>/dev/null || ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
echo 'PARTLABEL=omarchy / ext4 rw,noatime 0 1' > /etc/fstab
install -d -m 755 /mnt/stock
systemctl enable omarchy-pocket.service rgds-lid.service usbmux.service rgds-boot-ok.service sshd.service NetworkManager.service \\
  bluetooth.service avahi-daemon.service systemd-resolved.service power-profiles-daemon.service
systemctl --global enable omarchy-pocketd.service
# the user manager (and omarchy-pocketd) starts at boot, before the shell's session
install -d /var/lib/systemd/linger && touch /var/lib/systemd/linger/${user}
systemctl mask NetworkManager-wait-online.service
systemctl set-default multi-user.target
id ${user}`,
  },
  {
    name: "export",
    script: () => `du -sh --one-file-system / 2>/dev/null | tail -1`,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const options: Options = { user: opt("--user") ?? "omarchy" };
  const from = opt("--from");
  const only = opt("--only");
  const names = steps.map((s) => s.name);
  for (const n of [from, only]) if (n && !names.includes(n)) throw new Error(`unknown step ${n}; steps: ${names.join(" ")}`);

  if ((await $`docker image inspect ${IMAGE}`.quiet().nothrow()).exitCode !== 0) {
    const tarball = join(CACHE, "ArchLinuxARM-aarch64-latest.tar.gz");
    if (!existsSync(tarball)) throw new Error(`missing ${tarball}`);
    await $`docker import --platform linux/arm64 ${tarball} ${IMAGE}`;
  }
  // a full build starts from a fresh container; --from/--only resume the existing one
  if (!from && !only) await $`docker rm -f ${CONTAINER}`.quiet().nothrow();
  const state = (await $`docker inspect -f {{.State.Running}} ${CONTAINER}`.quiet().nothrow()).text().trim();
  if (state === "false") await $`docker start ${CONTAINER}`.quiet();
  else if (state !== "true")
    await $`docker run -d --name ${CONTAINER} --platform linux/arm64 -e http_proxy=${PROXY} -e https_proxy=${PROXY} -v ${REPO}:/repo:ro ${IMAGE} sleep infinity`.quiet();

  const start = only ? names.indexOf(only) : from ? names.indexOf(from) : 0;
  const end = only ? start + 1 : steps.length;
  for (const step of steps.slice(start, end)) {
    console.error(`== ${step.name}`);
    const t = performance.now();
    const log = join(CACHE, `build-${step.name}.log`);
    const fd = openSync(log, "w");
    const proc = Bun.spawn(["docker", "exec", CONTAINER, "bash", "-euo", "pipefail", "-c", step.script(options)], {
      stdio: ["ignore", fd, fd],
    });
    const code = await proc.exited;
    closeSync(fd);
    const secs = ((performance.now() - t) / 1000).toFixed(0);
    console.error(`   exit ${code} in ${secs} s, log ${log}`);
    if (code !== 0) {
      console.error((await $`tail -20 ${log}`.text()).trimEnd());
      process.exit(1);
    }
    if (step.name === "export") {
      const out = join(CACHE, "rgds-root.tar.zst");
      await $`docker exec ${CONTAINER} bsdtar --numeric-owner --xattrs --acls --one-file-system -cf - -C / . | zstd -T0 -6 -q -f -o ${out}`;
      console.error(`   ${out}: ${(Bun.file(out).size / 1048576).toFixed(0)} MiB`);
    }
  }
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
