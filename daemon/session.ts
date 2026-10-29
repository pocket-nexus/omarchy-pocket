// The Omarchy user's session as the lock screen needs it: the user's own
// password, checked with unix_chkpwd (PAM's setuid helper that lets a user
// verify their own password, the way screen lockers do), and logind's
// PrepareForSleep, so the shell locks before suspend as Omarchy's hypridle
// does with `before_sleep_cmd = omarchy-system-lock`.
import dbus from "dbus-next";

export async function checkPassword(password: string): Promise<boolean> {
  const user = process.env.USER ?? "omarchy";
  const child = Bun.spawn(["/usr/bin/unix_chkpwd", user, "nullok"], {
    stdin: new TextEncoder().encode(`${password}\0`),
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await child.exited) === 0;
}

/** Calls `beforeSleep` when logind announces a suspend or hibernate. */
export async function watchSleep(beforeSleep: () => void) {
  const bus = dbus.systemBus();
  const login = await bus.getProxyObject("org.freedesktop.login1", "/org/freedesktop/login1");
  const manager = login.getInterface("org.freedesktop.login1.Manager");
  manager.on("PrepareForSleep", (starting: boolean) => {
    if (starting) beforeSleep();
  });
}
