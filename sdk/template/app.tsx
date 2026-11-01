// __TITLE__: one page of a grouped table to start from. Replace it.
import { createSignal } from "solid-js";
import { AppletSurface } from "@pocketjs/framework/applet";
import { View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { Pinstripes } from "../ui/chrome.tsx";
import { keep } from "../ui/keep.ts";
import { Legend } from "../ui/legend.tsx";
import { createNavStack, type LayerContext, type NavStack, type PageSpec } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { tableContent } from "../ui/table.tsx";
import { createPress, createTouchRouter, type Press } from "../ui/touch.ts";

const ALL_BUTTONS = 0xffff;

function homePage(press: Press, keys: () => boolean, _nav: NavStack, layer: LayerContext): PageSpec {
  const count = keep("count", () => createSignal(0));
  return {
    title: () => "__TITLE__",
    content: tableContent({
      sections: () => [
        {
          header: "Start here",
          footer: "Edit __NAME__/app.tsx, then run pocket-applet run __NAME__.",
          cells: [{ id: "home.count", label: "Tapped", value: String(count[0]()), accessory: "chevron", run: () => count[1](count[0]() + 1) }],
        },
      ],
      width: SCREEN_W,
      press,
      focus: layer.focus,
      keys,
    }),
  };
}

export default function App() {
  const press = createPress();
  // Without touch the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const stack = createNavStack({
    restore: "__NAME__",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page: (_id, nav, layer) => homePage(press, keys, nav, layer),
  });
  if (stack.entries().length === 0) stack.reset("home");
  createTouchRouter({ surface: appletSurfaceId(), press, page: () => stack.touch(), active: () => !stack.busy(), onTouch: () => setKeys(false) });
  onButtonPress(ALL_BUTTONS, (pressed) => void stack.key(pressed));
  return (
    <AppletSurface>
      <View class="relative w-full h-full bg-[#c9d0d8] overflow-hidden">{stack.view()}</View>
      <Legend home />
    </AppletSurface>
  );
}
