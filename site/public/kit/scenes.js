// What the model's panels can show, and what its buttons do on the real shell
// (docs/interaction.md, shell/src/chords.ts). Every panel image is a GPU readback
// from the device; see site/shots.ts.
export const shot = (id) => [`/shots/${id}-top.webp`, `/shots/${id}-bottom.webp`];
export const show = (device, id, opts) => device.show(...shot(id), opts);

const KEY_SAYS = {
  DPAD: "D-pad: the arrow keys. Under L1 it moves focus, under R1 it swaps windows.",
  A: "A is Enter. Under L1 it opens Omarchy's menu.",
  B: "B is Backspace. Under L1 it closes the window.",
  X: "X is Tab. Under L1 it makes the window fullscreen.",
  Y: "Y is Space. Under L1 it toggles the split.",
  START: "START is Escape. Under L1 it changes the workspace's layout.",
  L2: "L2 goes to the previous workspace.",
  R2: "R2 goes to the next workspace.",
  STICK: "Under R1 the stick resizes: the focused window's edge goes the way you push it.",
  FN1: "A system button, kept by the device.",
  FN2: "A system button, kept by the device.",
};

/**
 * Makes the model's buttons behave as the shell does: L1 and R1 are SUPER and,
 * held, the bottom screen draws their layer's buttons with what each does;
 * SELECT turns the deck's layout.
 * `say(text)` receives one sentence for each press.
 */
export function attachButtons(device, { say = () => {}, rest = "split", onScene = () => {}, shoulders = null } = {}) {
  const layouts = [["keys", "split"], ["pad", "pad"], ["home", "home"]];
  let layout = 0, current = rest;
  const go = (id) => { current = id; show(device, id, { ms: 260 }); onScene(id); };
  device.on("press", (name) => {
    if (name === "L1") { show(device, "legend", { ms: 120 }); say("L1 held: the window layer. After a quarter second the bottom screen draws the buttons around it, each with what it does."); return; }
    if (name === "R1") { show(device, "legend-move", { ms: 120 }); say("R1 held: the move layer. Swap windows, open another, reopen one you closed; push the stick to move the window's edge."); return; }
    if (name === "SELECT") {
      layout = (layout + 1) % layouts.length;
      go(layouts[layout][1]);
      say(`SELECT turns the deck's layout. This is ${layouts[layout][0]}.`);
      return;
    }
    if (KEY_SAYS[name]) say(KEY_SAYS[name]);
  });
  device.on("release", (name) => { if (name === "L1" || name === "R1") show(device, current, { ms: 160 }); });
  // The shoulders sit behind the hinge, out of sight from the front: two chips
  // ride on their projected positions so a pointer can reach them.
  if (shoulders) {
    const chips = ["L1", "R1"].map((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = name; b.className = "shoulder"; b.setAttribute("aria-label", `Hold ${name}`);
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("down"); device.hold(name, true); });
      const lift = () => { if (b.classList.contains("down")) { b.classList.remove("down"); device.hold(name, false); } };
      b.addEventListener("pointerup", lift); b.addEventListener("pointercancel", lift);
      shoulders.appendChild(b);
      return { b, name };
    });
    const place = () => { for (const { b, name } of chips) { const p = device.anchor(name); b.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`; } };
    device.on("frame", place); place();
  }
  return { go, get current() { return current; }, set current(v) { current = v; } };
}

export const REPO = "https://github.com/pocket-nexus/omarchy-pocket";
