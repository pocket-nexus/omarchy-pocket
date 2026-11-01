// SPDX-License-Identifier: GPL-3.0-or-later
// applets/reddit/app.tsx — Reddit in a window of Omarchy Pocket's shell,
// read without an account.
//
// The feed of a subreddit under a Hot/New/Top segmented control, a post
// with its picture or text and its comments, and the subreddits page: a
// search typed on the deck's keyboard, and the subreddits kept in the
// companion's store. L and R change the sort, triangle reloads, square
// opens the subreddits. Pages, posts, searches and pictures come from
// omarchy-pocketd's reddit service.

import { createSignal } from "solid-js";
import { AppletSurface } from "@pocketjs/framework/applet";
import { View } from "@pocketjs/framework/components";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { companionNow } from "../lib/net.ts";
import { Pinstripes } from "../ui/chrome.tsx";
import { keep } from "../ui/keep.ts";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createRedditClient } from "./api.ts";
import { createRedditModel } from "./model.ts";
import { feedPage, postPage, setupPage, subsPage, type RedditEnv, type SetupDraft } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
const MAX_QUERY = 60;
/** A client id is about 22 characters, a secret about 30; a password may be long. */
const MAX_FIELD = 200;

export default function Reddit() {
  const client = keep("client", () => createRedditClient());
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const [draft, setDraft] = createSignal("");
  // the keyboard types into the search, or into one of the setup page's fields
  type Field = "query" | "clientId" | "clientSecret" | "username" | "password";
  let field: Field = "query";
  const [edits, setEdits] = createSignal(0);
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: MAX_FIELD,
    onCommit: (text) => {
      if (field === "query") return model.setQuery(text.slice(0, MAX_QUERY));
      setup[field] = text.trim();
      setup.message = "";
      setEdits(edits() + 1);
    },
  });
  legendWhileTyping(osk.isOpen, "Done");
  // the model and the setup draft outlive a remount; their hooks into this mount's keyboard are set each time
  const hooks = keep("hooks", () => ({ editQuery: () => {} }));
  hooks.editQuery = () => {
    field = "query";
    setDraft(model.search().query);
    osk.open();
  };
  const setup = keep<SetupDraft>("setup", () => ({ clientId: "", clientSecret: "", username: "", password: "", message: "", edit: () => {} }));
  setup.edit = (name) => {
    field = name;
    setDraft(setup[name]);
    osk.open();
  };
  const model = keep("model", () => createRedditModel(client, hooks));
  // Ages need minutes, not frames: the clock signal changes once a minute.
  const [now, setNow] = createSignal(Math.floor(companionNow() / 60000) * 60000);
  let frames = 0;
  onFrame(() => {
    if (++frames % 60 === 0) setNow(Math.floor(companionNow() / 60000) * 60000);
  });
  const env: RedditEnv = { model, press, keys, now, draft: () => (osk.isOpen() ? osk.display("|") : null), setup, edits };

  const stack = createNavStack({
    restore: "reddit",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav, layer) {
      return id === "post" ? postPage(env, nav, layer) : id === "subs" ? subsPage(env, nav, layer) : id === "setup" ? setupPage(env, nav, layer) : feedPage(env, nav, layer);
    },
  });
  if (stack.entries().length === 0) stack.reset("feed");

  createTouchRouter({
    surface: appletSurfaceId(),
    press,
    page: () => stack.touch(),
    active: () => !stack.busy() && !osk.isOpen(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (osk.isOpen()) return;
    stack.key(pressed);
  });

  const keyboardTop = SCREEN_H - oskHeight(appletSurfaceId(), "light");
  return (
    <AppletSurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
          <Osk osk={osk} surface={appletSurfaceId()} theme="light" />
        </View>
      </View>
      <Legend home />
    </AppletSurface>
  );
}
