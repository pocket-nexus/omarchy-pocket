#!/usr/bin/env python3
# The RG DS Plus lid. Anbernic's rk805 pwrkey driver reports its hall sensor as
# keys, not as the SW_LID switch logind watches: closing presses KEY_INSERT
# (110), opening presses KEY_DELETE (111). A close suspends the system.
import glob, os, struct, subprocess

KEY_INSERT = 110


def lid_device():
    for event in sorted(glob.glob("/sys/class/input/event*")):
        with open(event + "/device/name") as name:
            if name.read().strip() == "rk805 pwrkey":
                return "/dev/input/" + os.path.basename(event)
    raise SystemExit("no rk805 pwrkey input device")


fd = os.open(lid_device(), os.O_RDONLY)
while True:
    data = os.read(fd, 24 * 16)
    for at in range(0, len(data) - 23, 24):
        _, _, kind, code, value = struct.unpack("qqHHi", data[at:at + 24])
        if kind == 1 and code == KEY_INSERT and value == 1:
            subprocess.run(["systemctl", "suspend"], check=False)
