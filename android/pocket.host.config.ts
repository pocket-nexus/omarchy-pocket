import { parsePocketProfile } from "../vendor/pocketjs/framework/src/profile.ts";
import { defineHostConfig } from "../vendor/pocketjs/framework/src/host-config.ts";
import { HOST_CAPABILITIES } from "../host/pocket.host.config.ts";
import contract from "./pocket.host.json" with { type: "json" };

/** The AYN Thor as an Android app: the same host program as the RG DS Plus
 * (host/, built as libomarchy_pocket.so for aarch64-linux-android), its two
 * displays as Android windows on the GPU, the Odin controller as buttons and
 * the lower display's touch. The upper display (1920x1080) and the lower one
 * (1240x1080) share raster density 3. */
const selected = parsePocketProfile(contract);
const absent = selected.capabilities.filter((capability) => !HOST_CAPABILITIES.includes(capability));
if (absent.length) throw new Error(`${selected.id}: host contract promises capabilities absent from the host program: ${absent.join(", ")}`);

// tools/android.ts builds the library and the app; `pocket compile` reads the host contract from here.
export default defineHostConfig({
  host: "./pocket.host.json",
});
