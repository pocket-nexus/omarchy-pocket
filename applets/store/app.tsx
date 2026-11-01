// SPDX-License-Identifier: GPL-3.0-or-later
// applets/store/app.tsx — the store of Omarchy Pocket's applets: oma.pocket.nexus
// through omarchy-pocketd (daemon/appstore.ts), which checks and installs what
// this window asks for.

import { createSignal } from "solid-js";
import { AppletSurface } from "@pocketjs/framework/applet";
import { View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createAlerts } from "../ui/alert.tsx";
import { Pinstripes } from "../ui/chrome.tsx";
import { keep } from "../ui/keep.ts";
import { Legend } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createStoreClient } from "./api.ts";
import { createStoreModel } from "./model.ts";
import { appPage, listPage, type StoreEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;

export default function Store() {
  const client = keep("client", () => createStoreClient());
  const model = keep("model", () => createStoreModel(client));
  const press = createPress();
  // Without touch the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const alerts = createAlerts(press);
  const env: StoreEnv = { model, client, press, keys, alerts };

  const stack = createNavStack({
    restore: "store",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav) {
      return id.startsWith("app:") ? appPage(env, id.slice(4), nav) : listPage(env, nav);
    },
  });
  if (stack.entries().length === 0) stack.reset("list");

  createTouchRouter({
    surface: appletSurfaceId(),
    press,
    page: () => alerts.touch() ?? stack.touch(),
    active: () => !stack.busy(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (alerts.key(pressed)) return;
    stack.key(pressed);
  });

  return (
    <AppletSurface>
      <View class="relative w-full h-full bg-[#c9d0d8] overflow-hidden">
        {stack.view()}
        {alerts.view()}
      </View>
      <Legend home />
    </AppletSurface>
  );
}
