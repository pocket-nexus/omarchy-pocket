#!/bin/sh
# Device side of the GPU spike: run Omarchy's Hyprland from the ALARM root in
# /opt/arch on the stock kernel, with Rockchip's libmali as EGL/GLES/GBM.
#   spike.sh start | stop | restore
# start stops the stock launcher and Weston; restore brings them back (a
# reboot does too: the stop flag lives in /tmp). Expects /tmp/hyprland.lua and
# /tmp/libpocket-egl-shim.so (egl-shim.c built for aarch64 glibc).
R=/opt/arch
U=omarchy
umask 022

mounts() {
  for d in proc sys dev; do mountpoint -q $R/$d || mount --rbind /$d $R/$d; done
  mountpoint -q $R/run || mount -t tmpfs -o mode=755 tmpfs $R/run
  mkdir -p $R/run/udev && { mountpoint -q $R/run/udev || mount --bind /run/udev $R/run/udev; }
  mountpoint -q $R/tmp || mount -t tmpfs tmpfs $R/tmp
}

mali() {
  install -d -m 755 $R/opt/mali
  for f in libmali.so.1.9.0 libmali-hook.so.1.9.0 libEGL.so.1 libGLESv2.so.2 libGLESv1_CM.so.1 libgbm.so.1; do
    install -m 755 /usr/lib/$f $R/opt/mali/
  done
  ln -sf libmali.so.1.9.0 $R/opt/mali/libmali.so.1
  ln -sf libmali-hook.so.1.9.0 $R/opt/mali/libmali-hook.so.1
  # glvnd's libOpenGL.so.0 dispatches to no vendor under libmali's EGL; GL calls must reach libmali
  ln -sf libmali.so.1 $R/opt/mali/libOpenGL.so.0
  install -m 755 /tmp/libpocket-egl-shim.so $R/opt/mali/
}

case "$1" in
  start)
    touch /tmp/stopAPP.ini
    killall dmenu.bin 2>/dev/null
    sleep 1
    /etc/init.d/S49weston stop
    sleep 1
    chmod 755 $R
    mounts
    mali
    chmod 666 /dev/mali0 /dev/dri/card0 /dev/dma_heap/system /dev/dma_heap/system-uncached /dev/rga /dev/mpp_service
    uid=$(chroot $R id -u $U)
    install -d -m 755 $R/run/user && install -d -m 700 $R/run/user/$uid && chroot $R chown $U: /run/user/$uid
    mkdir -p $R/home/$U/.config/hypr && cp /tmp/hyprland.lua $R/home/$U/.config/hypr/hyprland.lua && chroot $R chown -R $U: /home/$U/.config
    chroot $R /usr/bin/seatd -g seat > /tmp/seatd.log 2>&1 &
    sleep 1
    chroot $R /usr/bin/su - $U -c "env XDG_RUNTIME_DIR=/run/user/$uid LD_LIBRARY_PATH=/opt/mali LD_PRELOAD=/opt/mali/libpocket-egl-shim.so LIBSEAT_BACKEND=seatd Hyprland" > /tmp/hyprland.log 2>&1 &
    ;;
  stop)
    killall -q Hyprland seatd foot 2>/dev/null
    ;;
  restore)
    killall -q Hyprland seatd foot 2>/dev/null
    sleep 1
    rm -f /tmp/stopAPP.ini
    /etc/init.d/S49weston start
    sleep 2
    /etc/init.d/S60launch start
    ;;
esac
