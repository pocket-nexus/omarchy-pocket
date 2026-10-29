// Where omarchy-pocketd listens, for the daemon and the commands that talk to it.
import { join } from "node:path";
import { BRIDGE_DIRECTORY, BRIDGE_SOCKET } from "./protocol.ts";

export const RUNTIME = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`;
export const OMARCHY_PATH = process.env.OMARCHY_PATH ?? "/usr/share/omarchy";

export const bridgePath = join(RUNTIME, BRIDGE_DIRECTORY, BRIDGE_SOCKET);

/** omarchy-shell names its socket after md5("$OMARCHY_PATH/shell\n$WAYLAND_DISPLAY");
 *  there is no Wayland display here. */
export const shellPath = join(
  RUNTIME,
  `omarchy-shell-${new Bun.CryptoHasher("md5").update(`${OMARCHY_PATH}/shell\n${process.env.WAYLAND_DISPLAY ?? ""}`).digest("hex").slice(0, 16)}.sock`,
);
