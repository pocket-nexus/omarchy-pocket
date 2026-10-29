import { cargo, defineRuntimeConfig } from "../vendor/pocketjs/framework/src/runtime-config.ts";
import profile from "./profile.ts";

/** Services the host program composes: both panels on the GPU, evdev buttons
 * and touch on the lower panel, baked glyphs. */
export const HOST_CAPABILITIES: readonly string[] = [
  "input.buttons", "input.touch.auxiliary", "display.auxiliary", "text.glyphs.baked",
];

const absent = profile.capabilities.filter((capability) => !HOST_CAPABILITIES.includes(capability));
if (absent.length) throw new Error(`${profile.id}: profile promises capabilities absent from the host program: ${absent.join(", ")}`);

// tools/host.ts builds the program; `pocket compile` reads the profile from here.
export default defineRuntimeConfig({
  profile,
  build: {
    hosts: ["darwin-arm64", "linux-arm64", "linux-x64"],
    steps: cargo({ manifest: "../Cargo.toml", package: "omarchy-pocket-host", targetDirectory: "{outdir}/cargo", release: true }),
  },
});
