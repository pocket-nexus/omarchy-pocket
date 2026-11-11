import { parsePocketProfile } from "../vendor/pocketjs/framework/src/profile.ts";
import { cargo, defineHostConfig } from "../vendor/pocketjs/framework/src/host-config.ts";
import contract from "./pocket.host.json" with { type: "json" };

/** Services the host program composes: both panels on the GPU, evdev buttons
 * and touch on the lower panel, baked glyphs, media through omarchy-pocketd,
 * each app's worker domain, whose http node hands requests to
 * omarchy-pocketd (host/src/net.rs), and the shell's system.wifi
 * (host/src/system.rs: NetworkManager through omarchy-pocketd, or Android's
 * WifiManager on the AYN Thor). */
export const HOST_CAPABILITIES: readonly string[] = [
  "input.buttons", "input.text", "input.touch.auxiliary", "display.auxiliary", "text.glyphs.baked", "net.http", "media.playback", "runtime.worker", "system.wifi",
];

const selected = parsePocketProfile(contract);
const absent = selected.capabilities.filter((capability) => !HOST_CAPABILITIES.includes(capability));
if (absent.length) throw new Error(`${selected.id}: host contract promises capabilities absent from the host program: ${absent.join(", ")}`);

// tools/build.ts builds the program; `pocket compile` reads the host contract from here.
export default defineHostConfig({
  host: "./pocket.host.json",
  build: {
    hosts: ["darwin-arm64", "linux-arm64", "linux-x64"],
    steps: cargo({ manifest: "../Cargo.toml", package: "omarchy-pocket-host", targetDirectory: "{outdir}/cargo", release: true }),
  },
});
