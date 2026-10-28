#!/bin/bash
# Runs inside an aarch64 container whose / is the extracted ALARM rootfs, with
# the Omarchy repo mounted at /omarchy:
#   docker import --platform linux/arm64 ArchLinuxARM-aarch64-latest.tar.gz alarm
#   docker run --name rgds-spike --platform linux/arm64 -e https_proxy=… \
#     -v $OMARCHY:/omarchy:ro -v $PWD/spike-root.sh:/spike-root.sh:ro alarm bash /spike-root.sh
#   docker export rgds-spike | ssh … 'mkdir -p /opt/arch && tar -x -C /opt/arch'
# Builds the GPU spike root: Omarchy's pacman setup + Hyprland, seatd, foot, grim.
# keys.openpgp.org did not answer from this network; keyserver.ubuntu.com did.
set -euxo pipefail
OM=/omarchy
cp $OM/default/pacman/aarch64/pacman-stable.conf /etc/pacman.conf
cp $OM/default/pacman/aarch64/mirrorlist-stable /etc/pacman.d/mirrorlist
sed -i 's/^DownloadUser/#DownloadUser/' /etc/pacman.conf
grep -q '^DisableSandbox' /etc/pacman.conf || sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
pacman-key --init
pacman-key --populate archlinuxarm
curl -fsSL 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x40DFB630FF42BCFFB047046CF0134EE680CAC571' -o /tmp/omarchy.asc
pacman-key --add /tmp/omarchy.asc
pacman-key --list-keys 40DFB630FF42BCFFB047046CF0134EE680CAC571
pacman-key --lsign-key 40DFB630FF42BCFFB047046CF0134EE680CAC571
# the vendor kernel and its firmware stay; drop ALARM's kernel and linux-firmware
pacman -Rdd --noconfirm linux-aarch64 $(pacman -Qq | grep '^linux-firmware') || true
pacman -Syu --noconfirm
pacman -S --noconfirm --needed omarchy-keyring hyprland seatd foot grim ttf-jetbrains-mono-nerd-basic
rm -rf /var/cache/pacman/pkg/*
groupadd -f seat
id omarchy 2>/dev/null || useradd -m -G video,input,seat,audio -s /bin/bash omarchy
pacman -Q hyprland aquamarine mesa glibc 2>/dev/null || true
du -sh / --exclude=/proc --exclude=/sys --exclude=/omarchy 2>/dev/null | tail -1
