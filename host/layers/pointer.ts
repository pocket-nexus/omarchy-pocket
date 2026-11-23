// host/layers/pointer.ts — a system layer Omarchy Pocket adds to the applets
// that read a pointer (`pointer` in applet.services; daemon App.hover).
//
// The host program gives an applet its frame through PocketJS's frame
// function, and the one this host is built from passes no pointer argument
// (PocketJS's frame argument 10, @pocketjs/framework/input pointer()). So the
// shell sends the stage pointer resting over an applet's window as a touch
// contact with the id HOVER_CONTACT (shell/src/stage/pointer.tsx
// pointerContacts), and this layer, compiled into the applet's bundle
// (`pocket-shell compile --layer`), takes that contact out of the frame's
// touches and hands it on as the frame's pointer with no button down. The
// applet sees what a host with a pointer driver gives it: hover from
// pointer(), presses as contacts.
import { registerSystemLayer, setFrameInputFilter, type FrameInput } from "@pocketjs/framework/system-layers";

/** the contact id of a pointer at rest (shell/src/stage/pointer.tsx) */
const HOVER_CONTACT = 15;
/** PocketJS's touch words (framework/src/touch.ts): a wide word carries 10-bit coordinates, a legacy one 9 */
const WIDE = 0x80000000;

function contact(word: number): { id: number; x: number; y: number } {
  const bits = word & WIDE ? 10 : 9;
  const mask = (1 << bits) - 1;
  return { id: (word >>> (bits * 2)) & 0xff, x: word & mask, y: (word >>> bits) & mask };
}

function lift(input: FrameInput): void {
  const touches = input.touches;
  if (!touches || touches.length === 0) return;
  let at = -1;
  for (let i = 0; i < touches.length; i++) if (contact(touches[i]!).id === HOVER_CONTACT) at = i;
  if (at < 0) return;
  const { x, y } = contact(touches[at]!);
  const without = <T>(list: readonly T[] | undefined) => list?.filter((_, i) => i !== at);
  input.pointer = { surface: input.surfaces?.[at] ?? 0, x, y, buttons: 0 };
  input.touches = without(touches);
  input.hits = without(input.hits);
  input.surfaces = without(input.surfaces);
}

registerSystemLayer(() => {
  setFrameInputFilter(lift);
  return () => setFrameInputFilter(null);
});
