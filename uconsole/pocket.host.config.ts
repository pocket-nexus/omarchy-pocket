import { parsePocketProfile } from "../vendor/pocketjs/framework/src/profile.ts";
import { defineHostConfig } from "../vendor/pocketjs/framework/src/host-config.ts";
import { HOST_CAPABILITIES } from "../host/pocket.host.config.ts";
import contract from "./pocket.host.json" with { type: "json" };

/** The ClockworkPi uConsole (Raspberry Pi CM4): the RG DS Plus's host program
 * (host/, built with Mesa's EGL, GLES and GBM in place of libmali) on its one
 * 5" DSI panel, a 720x1280 portrait panel the program turns a quarter to
 * stand 1280x720, and the keyboard's three USB functions: the keys as text
 * events, the gamepad's buttons, and the trackball and its two mouse buttons,
 * which the shell reads for its pointer (host/src/uconsole.rs). */
const selected = parsePocketProfile(contract);
const absent = selected.capabilities.filter((capability) => !HOST_CAPABILITIES.includes(capability));
if (absent.length) throw new Error(`${selected.id}: host contract promises capabilities absent from the host program: ${absent.join(", ")}`);

// tools/uconsole.ts builds the program and the shell; `pocket compile` reads the host contract from here.
export default defineHostConfig({
  host: "./pocket.host.json",
});
