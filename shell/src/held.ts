// The chord layer the shoulders hold (chords.ts): window under L1, move
// under R1, workspace under both, plain with neither. It is the layer in
// force for the gamepad, and the bar names it while it lasts; the stage shows
// the layer's bindings once a shoulder has been held a moment
// (stage/keysheet.tsx). It lets go with the shoulder: nothing latches it.
import { createSignal } from "solid-js";
import type { Layer } from "./chords.ts";

const [held, setHeld] = createSignal<Layer>("plain");

export { held as heldLayer, setHeld as setHeldLayer };
