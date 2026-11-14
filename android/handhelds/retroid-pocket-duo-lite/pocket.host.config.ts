import { parsePocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { defineHostConfig } from "../../../vendor/pocketjs/framework/src/host-config.ts";
import { HOST_CAPABILITIES } from "../../../host/pocket.host.config.ts";
import contract from "./pocket.host.json" with { type: "json" };

/** The Retroid Pocket Duo Lite as an Android app: the AYN Thor's program
 * (host/, libomarchy_pocket.so), its upper display (1920x1080) and its lower
 * one (1280x960) as Android windows on the Adreno 610, the Retroid Pocket
 * Controller as buttons and the lower display's touch. Both share raster
 * density 3: 640 x 360 points over 426 x 320 (1278 x 960 pixels; the lower
 * display's last two columns stay black). */
const selected = parsePocketProfile(contract);
const absent = selected.capabilities.filter((capability) => !HOST_CAPABILITIES.includes(capability));
if (absent.length) throw new Error(`${selected.id}: host contract promises capabilities absent from the host program: ${absent.join(", ")}`);

// tools/android.ts builds the library and the app; `pocket compile` reads the host contract from here.
export default defineHostConfig({
  host: "./pocket.host.json",
});
