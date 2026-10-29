// The deck's body while a package window is focused and its controls are up
// (SELECT, the dock's keyboard cell, a second tap in the map). A package
// with a touch surface (app.surfaces.auxiliary) shows it here, letterboxed
// into the body, and the fingers on it are its contacts, in its own points;
// a package without one gets a touch gamepad laid out like the device's
// buttons (D-pad; X top, Y left, A right, B bottom; START), each cap a
// button while a finger is on it.
import { createEffect, createSignal, For, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { C } from "../classes.ts";
import { appTextures } from "../packages.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import type { Win } from "../workspaces.ts";
import { BODY_H } from "./geometry.ts";

type AppWin = Extract<Win, { kind: "app" }>;

const SCALE = Math.min(512 / 512, BODY_H / 384);
const SURFACE_W = 512 * SCALE;
const SURFACE_H = 384 * SCALE;
const SURFACE_X = (512 - SURFACE_W) / 2;

interface Cap {
  button: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const D = 58;
const PAD_X = 40;
const PAD_Y = 70;
const FACE_X = 300;
const CAPS: Cap[] = [
  { button: BTN.UP, label: "↑", x: PAD_X + D, y: PAD_Y, w: D, h: D },
  { button: BTN.LEFT, label: "←", x: PAD_X, y: PAD_Y + D, w: D, h: D },
  { button: BTN.RIGHT, label: "→", x: PAD_X + 2 * D, y: PAD_Y + D, w: D, h: D },
  { button: BTN.DOWN, label: "↓", x: PAD_X + D, y: PAD_Y + 2 * D, w: D, h: D },
  { button: BTN.TRIANGLE, label: "X", x: FACE_X + D, y: PAD_Y, w: D, h: D },
  { button: BTN.SQUARE, label: "Y", x: FACE_X, y: PAD_Y + D, w: D, h: D },
  { button: BTN.CIRCLE, label: "A", x: FACE_X + 2 * D, y: PAD_Y + D, w: D, h: D },
  { button: BTN.CROSS, label: "B", x: FACE_X + D, y: PAD_Y + 2 * D, w: D, h: D },
  { button: BTN.START, label: "START", x: 206, y: 262, w: 100, h: 36 },
];
const capAt = (x: number, y: number) => CAPS.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);

/** the caps under a finger, lit */
const [held, setHeld] = createSignal(0);

/** This frame's input for the package from the body's fingers (body coordinates). */
export function appControlsTouch(frame: TouchFrame, win: AppWin): { buttons: number; contacts: number[] } {
  if (win.aux) {
    const contacts: number[] = [];
    for (const c of frame.down) {
      const x = (c.x - SURFACE_X) / SCALE;
      const y = c.y / SCALE;
      if (x >= 0 && x < 512 && y >= 0 && y < 384) contacts.push(c.id, x, y);
    }
    return { buttons: 0, contacts };
  }
  let buttons = 0;
  for (const c of frame.down) buttons |= capAt(c.x, c.y)?.button ?? 0;
  if (buttons !== held()) setHeld(buttons);
  return { buttons, contacts: [] };
}

function Surface(props: { win: AppWin }) {
  let node: NodeMirror | undefined;
  const texture = () => appTextures(props.win.app)?.[1];
  createEffect(() => {
    const t = texture();
    if (node && t !== undefined) getOps().setImage(node.id, t);
  });
  return (
    <Image
      ref={(n: NodeMirror) => (node = n)}
      class="absolute top-0"
      src="wall-0-0.png"
      style={{ insetL: SURFACE_X, width: SURFACE_W, height: SURFACE_H, scaleY: -1, opacity: texture() === undefined ? 0 : 1 }}
    />
  );
}

function Gamepad(props: { win: AppWin }) {
  return (
    <>
      <Text class={C.crumbs} style={{ textColor: color("accent") }}>{props.win.title}</Text>
      <Text class="absolute right-[12] top-[8] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>the buttons, by touch</Text>
      <View class={C.rule} style={{ bgColor: color("muted") }} />
      <For each={CAPS}>
        {(cap) => (
          <View class="absolute rounded-md" style={{ insetL: cap.x + 2, insetT: cap.y + 2, width: cap.w - 4, height: cap.h - 4, bgColor: color(held() & cap.button ? "accent" : "dark_background") }}>
            <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: (cap.h - 4) / 2 - 8, width: cap.w - 4, textColor: color(held() & cap.button ? "background" : "foreground") }}>
              {cap.label}
            </Text>
          </View>
        )}
      </For>
    </>
  );
}

export function AppControls(props: { win: AppWin }) {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Show when={props.win.aux} fallback={<Gamepad win={props.win} />}>
        <Surface win={props.win} />
      </Show>
    </View>
  );
}
