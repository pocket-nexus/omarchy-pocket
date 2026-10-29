#!/usr/bin/env bun
// Installs the Omarchy root built by build-root.ts onto the RG DS Plus SD card,
// driving the stock firmware over SSH (normally the USB link on port 2222).
//
//   bun image/install.ts <step>... [--ssh "ssh -p 2222 -o HostKeyAlias=192.168.8.175 root@127.0.0.1"]
//   steps: check partition extract configure chooser reboot
//
// Card layout after `partition`: p1-p6 untouched (U-Boot, misc, boot, recovery,
// backup, stock rootfs); the stock p7-p11 (ports, vendor, oem, userdata, ROMS)
// are replaced by p7 "omarchy" (ext4) to the end of the card. The stock rootfs
// stays the kernel's root; `chooser` makes its /sbin/init pivot into p7.
// `partition` refuses to run unless the full-card backup exists.
import { $ } from "bun";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const ROOT_TAR = join(REPO, ".cache", "rgds-root.tar.zst");
const BACKUP = join(homedir(), "Backups", "rg-ds-plus", "2026-10-29-stock-sd.img.zst");
const DISK = "/dev/mmcblk1";
const OMARCHY_START = 10977280; // first sector of the stock p7 ("ports"), right after rootfs
const ARCH = "/opt/arch"; // ALARM root on the stock rootfs: util-linux partx and bsdtar

const args = process.argv.slice(2);
const sshAt = args.indexOf("--ssh");
const ssh = (sshAt >= 0 ? args.splice(sshAt, 2)[1] : "ssh -o ConnectTimeout=10 -p 2222 -o HostKeyAlias=192.168.8.175 root@127.0.0.1").split(" ");

async function remote(script: string, stdin?: Blob) {
  const proc = Bun.spawn([...ssh, "sh -euc " + shellQuote(script)], { stdin: stdin ?? "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`remote step failed (${code})`);
}

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

const archChroot = `
for d in proc sys dev; do mountpoint -q ${ARCH}/$d || mount --rbind /$d ${ARCH}/$d; done
`;

const steps: Record<string, () => Promise<void>> = {
  async check() {
    await remote(`
grep -q rk3568 /proc/device-tree/compatible || { echo "not an RK3568"; exit 1; }
[ "$(cat /sys/class/anbernic_misc/boot_device)" = 1 ] || { echo "not booted from the SD card"; exit 1; }
for p in 7 8 9 10 11; do
  if grep -q "^${DISK}p$p " /proc/mounts; then echo "${DISK}p$p is mounted"; exit 1; fi
done
sgdisk -p ${DISK} | tail -n +9
[ -x ${ARCH}/usr/bin/partx ] && [ -x ${ARCH}/usr/bin/bsdtar ] || { echo "${ARCH} lacks partx/bsdtar"; exit 1; }
echo check-ok`);
  },

  async partition() {
    const sha = BACKUP.replace(/\.zst$/, ".sha256");
    if (!existsSync(BACKUP) || !existsSync(sha) || statSync(sha).size === 0)
      throw new Error(`no finished full-card backup at ${BACKUP} (+ .sha256)`);
    await remote(`
for p in 7 8 9 10 11; do
  if grep -q "^${DISK}p$p " /proc/mounts; then echo "${DISK}p$p is mounted"; exit 1; fi
done
# the stock image was made for a smaller card: move the backup GPT to the end first
sgdisk -e -d 7 -d 8 -d 9 -d 10 -d 11 -n 7:${OMARCHY_START}:0 -t 7:8300 -c 7:omarchy ${DISK} || true
sgdisk -v ${DISK} | tail -2
# the kernel keeps p6 (mounted root) busy, so update only p7-p11 in its table
${archChroot}
chroot ${ARCH} partx -d --nr 7:11 ${DISK} || true
chroot ${ARCH} partx -a --nr 7 ${DISK}
# partx adds the partition without its GPT name; the kernel reads PARTNAME=omarchy
# from the table at the next boot, which is when rgds-init looks for it
[ "$(cat /sys/class/block/mmcblk1p7/start)" = ${OMARCHY_START} ]
mkfs.ext4 -F -q -L omarchy ${DISK}p7
sgdisk -p ${DISK} | tail -n +9`);
  },

  async extract() {
    if (!existsSync(ROOT_TAR)) throw new Error(`missing ${ROOT_TAR}; run image/build-root.ts`);
    await remote(`
mkdir -p /mnt/omarchy
mountpoint -q /mnt/omarchy || mount -t ext4 -o noatime ${DISK}p7 /mnt/omarchy
${archChroot}
mkdir -p ${ARCH}/mnt/target
mountpoint -q ${ARCH}/mnt/target || mount --bind /mnt/omarchy ${ARCH}/mnt/target
chroot ${ARCH} bsdtar -xpf - --numeric-owner --xattrs --acls --no-fflags -C /mnt/target
chmod 755 /mnt/omarchy
sync
df -h /mnt/omarchy | tail -1`, Bun.file(ROOT_TAR));
  },

  async configure() {
    const key = join(homedir(), ".ssh", "id_ed25519.pub");
    const pub = existsSync(key) ? (await Bun.file(key).text()).trim() : "";
    await remote(`
T=/mnt/omarchy
mountpoint -q $T || mount -t ext4 -o noatime ${DISK}p7 $T
echo rgds > $T/etc/hostname
printf '127.0.0.1 localhost\\n::1 localhost\\n127.0.1.1 rgds\\n' > $T/etc/hosts
: > $T/etc/machine-id
# keep the stock host keys, so known_hosts entries for this device stay valid
cp -a /etc/ssh/ssh_host_* $T/etc/ssh/
install -d -m 700 $T/etc/NetworkManager/system-connections
cp -a /etc/NetworkManager/system-connections/. $T/etc/NetworkManager/system-connections/
chmod 600 $T/etc/NetworkManager/system-connections/*
# Realtek RTL8821CS Wi-Fi/BT and AW883xx amplifier firmware from the stock root
cp -a /lib/firmware/. $T/usr/lib/firmware/
# the stock kernel builds the Wi-Fi driver and the UART Bluetooth glue as modules
install -d $T/usr/lib/modules/6.1.141/extra
cp /lib/modules/*.ko $T/usr/lib/modules/6.1.141/extra/
chroot $T depmod 6.1.141 2>/dev/null || true
printf '%s\n' '# Realtek RTL8821CS SDIO Wi-Fi, a module of the stock kernel' RTL8821CS > $T/etc/modules-load.d/rgds-wifi.conf
if [ -n ${shellQuote(pub)} ]; then
  for r in / $T/; do install -d -m 700 \${r}root/.ssh; grep -qxF ${shellQuote(pub)} \${r}root/.ssh/authorized_keys 2>/dev/null || echo ${shellQuote(pub)} >> \${r}root/.ssh/authorized_keys; done
fi
sync
echo configure-ok`);
  },

  async chooser() {
    const init = Bun.file(join(REPO, "device", "stock", "rgds-init"));
    const s45 = Bun.file(join(REPO, "device", "stock", "S45usbmux"));
    const mux = Bun.file(join(REPO, "tools", "usb-link", "usbmux.py"));
    await remote(`cat > /tmp/rgds-init.new && busybox sh -n /tmp/rgds-init.new`, init);
    await remote(`install -D -m 755 /dev/stdin /etc/init.d/S45usbmux`, s45);
    await remote(`install -D -m 755 /dev/stdin /usr/lib/pocket-rgds/usbmux.py`, mux);
    await remote(`
install -m 755 /tmp/rgds-init.new /sbin/rgds-init
[ -e /sbin/init.stock ] || ln -s ../bin/busybox /sbin/init.stock
ln -sfn rgds-init /sbin/init
rm -f /.rgds-boot-tries
sync
ls -la /sbin/init /sbin/init.stock /sbin/rgds-init`);
  },

  async reboot() {
    await remote(`sync; (sleep 1; reboot) >/dev/null 2>&1 &`);
  },
};

async function main() {
  const wanted = args.filter((a) => !a.startsWith("--"));
  if (!wanted.length) throw new Error(`usage: bun image/install.ts <${Object.keys(steps).join("|")}>...`);
  for (const name of wanted) {
    const step = steps[name];
    if (!step) throw new Error(`unknown step ${name}`);
    console.error(`== ${name}`);
    await step();
  }
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
