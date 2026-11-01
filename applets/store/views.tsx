// SPDX-License-Identifier: GPL-3.0-or-later
// applets/store/views.tsx — the store's pages: the list of apps with their
// GET / UPDATE / OPEN buttons, and an app's page with who made it, what it
// reaches and its Remove button. An app from anyone but Pocket Nexus says what
// it will reach in an alert before it installs.

import { createEffect, createMemo, For, onMount, Show, type Accessor } from "solid-js";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Image, Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import type { Alerts } from "../ui/alert.tsx";
import type { NavStack, PageSpec } from "../ui/nav.tsx";
import { SCREEN_W } from "../ui/screen.ts";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import { actionOf, sizeText, type StoreApp, type StoreClient } from "./api.ts";
import type { StoreModel } from "./model.ts";

export interface StoreEnv {
  model: StoreModel;
  client: StoreClient;
  press: Press;
  keys: Accessor<boolean>;
  alerts: Alerts;
}

const ROW = 64;
const LEFT = 9;
const TOP = 10;
const ICON = 48;
const BUTTON_W = 64;
const BUTTON_H = 26;
const width = () => SCREEN_W - LEFT * 2;
const LABEL = { get: "GET", update: "UPDATE", open: "OPEN", busy: "" } as const;

function AppIcon(props: { client: StoreClient; sha: string; x: number; y: number; size: number }) {
  let image!: NodeMirror;
  onMount(() => {
    createEffect(() => {
      props.client.icons();
      const handle = props.client.icon(props.sha);
      getOps().setImage(image.id, handle);
    });
  });
  return <Image ref={image} class="absolute" style={{ insetL: props.x, insetT: props.y, width: props.size, height: props.size }} />;
}

/** The app's button: what it offers, or a spinner while it works. */
function ActionButton(props: { env: StoreEnv; app: Accessor<StoreApp>; id: string; x: number; y: number }) {
  const action = () => actionOf(props.app(), props.env.model.busy(props.app().id));
  const lit = () => props.env.press.is(props.id);
  return (
    <Show
      when={action() !== "busy"}
      fallback={
        <View class="absolute" style={{ insetL: props.x + BUTTON_W / 2 - 9, insetT: props.y + 4 }}>
          <ClassicSpinner size={18} color={"#6d7584"} />
        </View>
      }
    >
      <View
        class={action() === "update"
          ? lit()
            ? "absolute rounded-[6] border border-[#163f86] bg-gradient-to-b from-[#2d5fb8] to-[#1b4592]"
            : "absolute rounded-[6] border border-[#1f4f9f] bg-gradient-to-b from-[#73a8f2] via-[#3f7ddc] to-[#2c66cc]"
          : lit()
            ? "absolute rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
            : "absolute rounded-[6] border border-[#a2a8b0] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
        style={{ insetL: props.x, insetT: props.y, width: BUTTON_W, height: BUTTON_H }}
      />
      <Text class={action() === "update" ? "absolute text-xs text-white font-bold text-center" : "absolute text-xs text-[#2c66cc] font-bold text-center"} style={{ insetL: props.x, insetT: props.y + 6, width: BUTTON_W }}>
        {LABEL[action()]}
      </Text>
    </Show>
  );
}

/** Start what the button offers. An app from the store says what it reaches first. */
function act(env: StoreEnv, app: StoreApp): void {
  const action = actionOf(app, env.model.busy(app.id));
  if (action === "busy") return;
  if (action === "open") return env.model.open(app);
  if (app.official) return env.model.install(app);
  const reaches = app.hosts.length ? `It can reach ${app.hosts.join(", ")}.` : "It reaches nothing on the internet.";
  env.alerts.show({
    title: `${action === "update" ? "Update" : "Install"} ${toAscii(app.title)}?`,
    message: `By ${toAscii(app.author)}. ${reaches} It cannot see your accounts or other apps' data.`,
    action: action === "update" ? "Update" : "Install",
    run: () => env.model.install(app),
  });
}

function Row(props: { env: StoreEnv; app: Accessor<StoreApp>; index: number; lit: Accessor<boolean> }) {
  const app = props.app;
  const y = props.index * ROW;
  const textW = () => width() - 66 - BUTTON_W - 14;
  const meta = () => {
    const failed = props.env.model.failure(app().id);
    return failed ? ellipsize(failed, FONT.xs, textW()) : ellipsize(`${toAscii(app().author)}  ${sizeText(app().bytes)}`, FONT.xs, textW());
  };
  return (
    <>
      <View class={props.lit() ? "absolute bg-gradient-to-b from-[#058cf5] to-[#015ee6]" : "hidden"} style={{ insetL: 0, insetT: y, width: width(), height: ROW }} />
      <View class="absolute h-[1] bg-[#d9dce0]" style={{ insetL: 66, insetT: y + ROW - 1, width: width() - 66 }} />
      <AppIcon client={props.env.client} sha={app().icon} x={8} y={y + 8} size={ICON} />
      <Text class={props.lit() ? "absolute text-sm text-white font-bold" : "absolute text-sm text-black font-bold"} style={{ insetL: 66, insetT: y + 7 }}>{ellipsize(toAscii(app().title), FONT.smBold, textW())}</Text>
      <Text class={props.lit() ? "absolute text-xs text-[#e6f0ff]" : "absolute text-xs text-[#4f5663]"} style={{ insetL: 66, insetT: y + 25 }}>{ellipsize(toAscii(app().summary), FONT.xs, textW())}</Text>
      <Text class={props.env.model.failure(app().id) ? "absolute text-xs text-[#c4241b]" : props.lit() ? "absolute text-xs text-[#d8e8ff]" : "absolute text-xs text-[#8a9099]"} style={{ insetL: 66, insetT: y + 42 }}>{meta()}</Text>
      <ActionButton env={props.env} app={app} id={`store.act.${app().id}`} x={width() - BUTTON_W - 8} y={y + (ROW - BUTTON_H) / 2} />
    </>
  );
}

function Message(props: { title: string; detail: string; spinner?: boolean }) {
  const lines = () => wrap(props.detail, FONT.xs, SCREEN_W - 40, 4);
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute top-[36]" style={{ insetL: SCREEN_W / 2 - 11 }}>
          <ClassicSpinner size={22} color={"#6d7584"} />
        </View>
      </Show>
      <Text class="absolute left-0 top-[72] text-base text-[#4c566c] font-bold text-center" style={{ width: SCREEN_W }}>{props.title}</Text>
      <For each={lines()}>{(line, index) => <Text class="absolute left-[20] text-xs text-[#5d6677] text-center" style={{ insetT: 96 + index() * 15, width: SCREEN_W - 40 }}>{line}</Text>}</For>
    </>
  );
}

export function listPage(env: StoreEnv, stack: NavStack): PageSpec {
  const { model, press } = env;
  const apps = model.apps;
  const details = (app: StoreApp) => stack.push(`app:${app.id}`);
  return {
    title: () => "Store",
    right: () => ({ id: "store.reload", label: "Reload", kind: "plain", run: () => model.reload() }),
    content: {
      view: () => (
        <Show
          when={model.status() === "ready" && apps().length > 0}
          fallback={
            model.status() === "loading"
              ? <Message spinner title="Loading" detail="Asking oma.pocket.nexus for its apps." />
              : model.status() === "error"
                ? <Message title="Could Not Reach the Store" detail={model.error()} />
                : <Message title="Nothing Here Yet" detail="No app has been published for this device." />
          }
        >
          <View class="absolute rounded-[8] border border-[#abb1b9] bg-white" style={{ insetL: LEFT, insetT: TOP, width: width(), height: apps().length * ROW }}>
            <For each={apps()}>
              {(app, index) => <Row env={env} app={() => model.app(app.id) ?? app} index={index()} lit={() => press.is(`store.row.${app.id}`)} />}
            </For>
          </View>
        </Show>
      ),
      height: () => (apps().length ? TOP * 2 + apps().length * ROW : 200),
      focusOrder: () => apps().map((app) => `store.row.${app.id}`),
      targets(top, offset, bottom) {
        const out: Target[] = [];
        apps().forEach((app, index) => {
          const y = top + TOP + index * ROW - offset;
          if (y + ROW <= top || y >= bottom) return;
          out.push({ id: `store.row.${app.id}`, x: LEFT, y, w: width(), h: ROW, run: () => details(app) });
          out.push({ id: `store.act.${app.id}`, x: LEFT + width() - BUTTON_W - 16, y, w: BUTTON_W + 16, h: ROW, run: () => act(env, model.app(app.id) ?? app) });
        });
        return out;
      },
      span(id) {
        const index = apps().findIndex((app) => `store.row.${app.id}` === id);
        return index < 0 ? null : [TOP + index * ROW, TOP + (index + 1) * ROW];
      },
      activate(id) {
        const app = apps().find((entry) => `store.row.${entry.id}` === id);
        if (app) details(app);
      },
    },
  };
}

const HEAD_H = 92;
const LINE = 17;
const TEXT_X = 88;

export function appPage(env: StoreEnv, id: string, stack: NavStack): PageSpec {
  const { model, press } = env;
  const app = () => model.app(id);
  const lines = createMemo(() => {
    const current = app();
    if (!current) return [] as string[];
    const out = wrap(toAscii(current.summary), FONT.sm, width() - 24);
    const reach = current.official ? "From Pocket Nexus." : current.hosts.length ? `Reaches ${current.hosts.join(", ")}.` : "Reaches nothing on the internet.";
    return [...out, "", ...wrap(reach, FONT.sm, width() - 24), `Version ${current.version}, ${sizeText(current.bytes)}`];
  });
  const removable = () => {
    const current = app();
    return !!current && current.installed !== null && !current.system;
  };
  const textH = () => 20 + lines().length * LINE;
  const removeY = () => HEAD_H + textH() + 12;
  const remove = () => {
    const current = app();
    if (!current) return;
    env.alerts.show({
      title: `Remove ${toAscii(current.title)}?`,
      message: "The app leaves this device. What it saved stays until you install it again.",
      action: "Remove",
      run: () => {
        model.remove(current);
        stack.pop();
      },
    });
  };
  const buttonId = `store.act.${id}`;
  return {
    title: () => toAscii(app()?.title ?? "App"),
    backLabel: "Store",
    content: {
      view: () => (
        <Show when={app()} fallback={<Message title="Not in the Store" detail="The store no longer lists this app." />}>
          {(current) => (
            <>
              <AppIcon client={env.client} sha={current().icon} x={12} y={12} size={64} />
              <Text class="absolute text-lg text-black font-bold" style={{ insetL: TEXT_X, insetT: 12 }}>{ellipsize(toAscii(current().title), FONT.lgBold, SCREEN_W - TEXT_X - 10)}</Text>
              <Text class="absolute text-xs text-[#4f5663]" style={{ insetL: TEXT_X, insetT: 36 }}>{ellipsize(toAscii(current().author), FONT.xs, SCREEN_W - TEXT_X - 10)}</Text>
              <ActionButton env={env} app={current} id={buttonId} x={TEXT_X} y={54} />
              <Show when={model.failure(id)}>
                <Text class="absolute text-xs text-[#c4241b]" style={{ insetL: TEXT_X + BUTTON_W + 8, insetT: 60 }}>{ellipsize(model.failure(id), FONT.xs, SCREEN_W - TEXT_X - BUTTON_W - 18)}</Text>
              </Show>
              <View class="absolute rounded-[8] border border-[#abb1b9] bg-white" style={{ insetL: LEFT, insetT: HEAD_H, width: width(), height: textH() }} />
              <Text class="absolute text-sm text-[#2c3a50] leading-[17]" style={{ insetL: LEFT + 12, insetT: HEAD_H + 10 }}>{lines().join("\n")}</Text>
              <Show when={removable()}>
                <View class={press.is("store.remove") ? "absolute rounded-[8] border border-[#abb1b9] bg-[#d9dce0]" : "absolute rounded-[8] border border-[#abb1b9] bg-white"} style={{ insetL: LEFT, insetT: removeY(), width: width(), height: 36 }} />
                <Text class="absolute text-sm text-[#c4241b] font-bold text-center" style={{ insetL: LEFT, insetT: removeY() + 10, width: width() }}>Remove</Text>
              </Show>
            </>
          )}
        </Show>
      ),
      height: () => removeY() + 48,
      focusOrder: () => (app() ? (removable() ? [buttonId, "store.remove"] : [buttonId]) : []),
      targets(top, offset) {
        const current = app();
        if (!current) return [];
        const out: Target[] = [{ id: buttonId, x: TEXT_X - 6, y: top + 48 - offset, w: BUTTON_W + 12, h: 38, run: () => act(env, current) }];
        if (removable()) out.push({ id: "store.remove", x: LEFT, y: top + removeY() - offset, w: width(), h: 36, run: remove });
        return out;
      },
      span: (target) => (target === buttonId ? [0, HEAD_H] : target === "store.remove" ? [removeY(), removeY() + 36] : null),
      activate(target) {
        const current = app();
        if (!current) return;
        if (target === buttonId) act(env, current);
        else if (target === "store.remove") remove();
      },
    },
  };
}
