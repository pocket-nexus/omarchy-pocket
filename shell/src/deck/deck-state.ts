// Whether the Omarchy deck is open over a focused window. Its own module, so
// the menu (which opens panels for `omarchy-shell shell summon`) and the
// deck read the same signal without importing each other.
import { createSignal } from "solid-js";

const [deckOpen, setDeckOpen] = createSignal(false);

export { deckOpen, setDeckOpen };
