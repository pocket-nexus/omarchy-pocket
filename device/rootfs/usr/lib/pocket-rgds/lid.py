#!/usr/bin/env python3
# The RG DS Plus lid. Anbernic's rk805 pwrkey driver reports its hall sensor as
# keys, not as the SW_LID switch logind watches: closing presses KEY_INSERT
# (110), opening presses KEY_DELETE (111). The hall switch's GPIO line reads
# low while the lid is closed.
#
# A closed lid keeps the system suspended. Other sources wake it with the lid
# still shut (the USB PHY, the PMIC, the hall line itself on resume), and a
# request that arrives while logind is still finishing the last suspend is
# refused ("already in progress"), so one request per close can leave the
# system running behind a closed lid. Instead, while the lid is closed, a
# suspend is requested once the system has been awake SETTLE seconds, again
# SETTLE seconds after a refusal, and again after every resume.
import glob, os, re, select, struct, subprocess, time

KEY_INSERT, KEY_DELETE = 110, 111
EVENT = struct.Struct("qqHHi")
SETTLE = 1.0
# an accepted request that never slept (a wake event aborted it) is repeated after this
STALE = 10.0
# while the lid is closed the loop looks this often for a resume
LOOK = 0.5


def lid_device():
    for event in sorted(glob.glob("/sys/class/input/event*")):
        with open(event + "/device/name") as name:
            if name.read().strip() == "rk805 pwrkey":
                return "/dev/input/" + os.path.basename(event)
    raise SystemExit("no rk805 pwrkey input device")


def hall_closed():
    """The hall line's level from debugfs, or None when it cannot be read."""
    try:
        with open("/sys/kernel/debug/gpio") as gpio:
            for line in gpio:
                level = re.search(r"\|hall switch\s*\)\s+in\s+(hi|lo)", line)
                if level:
                    return level.group(1) == "lo"
    except OSError:
        pass
    return None


def slept():
    """Seconds spent suspended since boot: CLOCK_BOOTTIME counts them, CLOCK_MONOTONIC does not."""
    return time.clock_gettime(time.CLOCK_BOOTTIME) - time.clock_gettime(time.CLOCK_MONOTONIC)


fd = os.open(lid_device(), os.O_RDONLY)
closed = bool(hall_closed())
due = time.monotonic() + SETTLE if closed else None
asleep = slept()
while True:
    wait = None if due is None else min(LOOK, max(0.0, due - time.monotonic()))
    if select.select([fd], [], [], wait)[0]:
        data = os.read(fd, EVENT.size * 16)
        for at in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, kind, code, value = EVENT.unpack_from(data, at)
            if kind == 1 and value == 1 and code in (KEY_INSERT, KEY_DELETE):
                closed = code == KEY_INSERT
                due = time.monotonic() + SETTLE if closed else None
    if slept() - asleep > 0.5:
        # a resume: the line says where the lid is now
        asleep = slept()
        level = hall_closed()
        closed = closed if level is None else level
        due = time.monotonic() + SETTLE if closed else None
        if closed:
            print("woke with the lid closed; suspending again", flush=True)
    if due is not None and time.monotonic() >= due:
        if hall_closed() is False:
            # the line reads open: the opening's event was lost
            closed, due = False, None
            continue
        accepted = subprocess.run(["systemctl", "suspend"], check=False).returncode == 0
        due = time.monotonic() + (STALE if accepted else SETTLE)
