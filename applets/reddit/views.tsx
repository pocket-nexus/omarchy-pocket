// SPDX-License-Identifier: GPL-3.0-or-later
// applets/reddit/views.tsx — the pages of Reddit: the feed of a subreddit
// under a Hot/New/Top segmented control, a post with its picture or text
// over its comments, and the subreddits page (the search and the kept
// list).
//
// The feed and the comments are fixed pools of slots (ui/slots.ts): a post
// row is its thumbnail, a two-line title and a line of subreddit, points,
// comments and age; a comment row its author line over its text, indented
// by depth with a coloured rule. The post's picture is the companion's
// 480 x 300 preview in the top-left of a 512 x 512 texture, drawn scaled to
// the width inside a box that cuts the texture's empty part off.

import { batch, createEffect, createMemo, createSignal, For, onMount, Show, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Image, Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { barButtonWidth, type NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_W, appletTouch } from "../ui/screen.ts";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import { tableContent, type Cell, type Section } from "../ui/table.tsx";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import { yourComputer } from "../ui/companion.ts";
import { ageText, countText, HOME_SUB, IMAGE, SORTS, THUMB, type Comment, type Post, type SetupFields, type Subreddit } from "./api.ts";
import type { RedditModel } from "./model.ts";

export interface RedditEnv {
  model: RedditModel;
  press: Press;
  keys: Accessor<boolean>;
  now: Accessor<number>;
  /** The keyboard's text with its caret while it is open, else null. */
  draft: Accessor<string | null>;
  /** The setup page's fields and the keyboard that edits them. */
  setup: SetupDraft;
  /** Bumps when the keyboard commits a setup field, so the page relays out. */
  edits: Accessor<number>;
}

/** What the setup page holds: kept across a remount by the app. */
export interface SetupDraft {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  message: string;
  edit(field: "clientId" | "clientSecret" | "username" | "password"): void;
}

const NO_ROWS: never[] = [];
const OVERSCAN = 96;

/** On a surface larger than the 3DS's, the bar keeps room for a Subs
 *  button right of the segmented control. */
const SUBS: NavButton = { id: "feed.subs", label: "Subs", kind: "plain", run: () => {} };

const SEG_X = 8;
const THUMB_W = 64;
const THUMB_H = 40;
const TITLE_LINE = 17;
const META_H = 15;
const MORE_H = 44;
/** The shortest post row: a one-line title beside no thumbnail. */
const POST_MIN_H = 8 + TITLE_LINE + META_H + 6;

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;
let SEG_W = 0;
let TITLE_W = 0;
let TITLE_W_THUMB = 0;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
  SEG_W = (W - SEG_X * 2 - barButtonWidth(SUBS) - 10) / SORTS.length;
  TITLE_W = W - 10 - 12;
  TITLE_W_THUMB = W - (8 + THUMB_W + 10) - 12;
}

// ---- the segmented control --------------------------------------------------------------

function segmentTargets(env: RedditEnv): Target[] {
  return SORTS.map((sort, index) => ({ id: `sort.${sort.id}`, x: SEG_X + index * SEG_W, y: 0, w: SEG_W, h: 36, run: () => env.model.setSort(sort.id) }));
}

function Segments(props: { env: RedditEnv }) {
  const { model, press } = props.env;
  return (
    <>
      <View class="absolute left-[8] top-[5] h-[26] rounded-[5] border border-[#b53400] bg-gradient-to-b from-[#ff8a5c] via-[#ff5a1f] to-[#e8450c]" style={{ width: SEG_W * SORTS.length }} />
      <For each={SORTS}>
        {(sort, index) => (
          <>
            <View
              class={model.sort() === sort.id || press.is(`sort.${sort.id}`)
                ? "absolute top-[6] h-[24] bg-gradient-to-b from-[#9e2a00] via-[#c23a06] to-[#d94a14]"
                : "hidden"}
              style={{ insetL: SEG_X + 1 + index() * SEG_W, width: SEG_W - 1 }}
            />
            <Show when={index() > 0}>
              <View class="absolute top-[6] w-[1] h-[24] bg-[#b53400]" style={{ insetL: SEG_X + index() * SEG_W }} />
            </Show>
            <Text class="absolute top-[11] text-xs text-[#7a2000a0] font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{sort.label}</Text>
            <Text class="absolute top-[12] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{sort.label}</Text>
          </>
        )}
      </For>
    </>
  );
}

// ---- post rows --------------------------------------------------------------------------

export interface PostRow {
  id: string;
  post: Post;
  title: string;
  thumb: boolean;
  meta: string;
  y: number;
  h: number;
}

function postMeta(post: Post, now: number, showSub: boolean): string {
  const parts: string[] = [];
  if (showSub) parts.push(`r/${toAscii(post.sub)}`);
  if (post.score >= 0) parts.push(`${countText(post.score)} points`);
  if (post.comments >= 0) parts.push(`${countText(post.comments)} comments`);
  if (post.created) parts.push(ageText(post.created, now));
  if (!post.isSelf && post.domain) parts.push(toAscii(post.domain));
  return parts.join("  ");
}

const titleCache = new Map<string, { post: Post; width: number; lines: string[] }>();

function titleLines(post: Post, width: number): string[] {
  const cached = titleCache.get(post.id);
  if (cached && cached.post === post && cached.width === width) return cached.lines;
  const lines = wrap(toAscii(post.title || "Untitled"), FONT.smBold, width, 2);
  if (titleCache.size > 600) titleCache.clear();
  titleCache.set(post.id, { post, width, lines });
  return lines;
}

const previousRows = new Map<string, PostRow>();

function postRows(env: RedditEnv): { rows: PostRow[]; height: number; more: boolean } {
  env.model.version();
  const feed = env.model.feed();
  const now = env.now();
  const showSub = env.model.sub() === HOME_SUB;
  let y = 0;
  const rows = feed.items.map((post) => {
    const thumb = post.thumb;
    const lines = titleLines(post, thumb ? TITLE_W_THUMB : TITLE_W);
    const textH = lines.length * TITLE_LINE + META_H;
    const h = 8 + Math.max(textH, thumb ? THUMB_H : 0) + 6;
    const meta = ellipsize(postMeta(post, now, showSub), FONT.xs, thumb ? TITLE_W_THUMB : TITLE_W);
    const title = lines.join("\n");
    const before = previousRows.get(post.id);
    const row = before && before.post === post && before.y === y && before.h === h && before.meta === meta && before.title === title
      ? before
      : { id: post.id, post, title, thumb, meta, y, h };
    previousRows.set(post.id, row);
    y += h;
    return row;
  });
  if (previousRows.size > 600) previousRows.clear();
  const more = feed.status === "ready" && !!feed.after;
  return { rows, height: y + (more ? MORE_H : 0), more };
}

function keyIndex<R extends { id: string }>(rows: () => readonly R[], prefix: string) {
  let built: readonly R[] | null = null;
  let order: string[] = [];
  let byKey = new Map<string, R>();
  return () => {
    const list = rows();
    if (list !== built) {
      built = list;
      order = list.map((row) => prefix + row.id);
      byKey = new Map(list.map((row, index) => [order[index]!, row]));
    }
    return { order, byKey };
  };
}

function highlight(env: RedditEnv, layer: LayerContext, prefix: string): (id: string) => boolean {
  const idOf = (key: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : "");
  const pressed = createMemo(() => idOf(env.press.id()));
  const focused = createMemo(() => (env.keys() ? idOf(layer.focus()) : ""));
  return (id) => id === pressed() || id === focused();
}

/** One slot of the feed's pool: its nodes mount once; the painter moves the
 *  slot and rewrites its texts for each new row; the thumbnail binds to the
 *  texture once the client has it. */
function PostSlot(props: { env: RedditEnv; pool: SlotPool<PostRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let title!: NodeMirror;
  let meta!: NodeMirror;
  let textCol!: NodeMirror;
  const [id, setId] = createSignal("");
  const [thumb, setThumb] = createSignal(false);
  const thumbKey = () => {
    props.env.model.client.pictures();
    return id() && thumb() ? props.env.model.client.thumb(id()) : "";
  };
  const lit = createMemo(() => id() !== "" && props.lit(id()));
  let y = -1;
  let h = -1;
  let withThumb: boolean | null = null;
  const recolor = () => {
    const on = lit();
    jump(wash, "opacity", on ? 1 : 0);
    jump(title, "textColor", on ? "#ffffff" : "#111111");
    jump(meta, "textColor", on ? "#d6e6ff" : "#8a9099");
  };
  onMount(() => {
    createEffect(recolor);
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        paintText(title, "");
        paintText(meta, "");
        setId("");
        setThumb(false);
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      if (row.thumb !== withThumb) {
        withThumb = row.thumb;
        jump(textCol, "insetL", withThumb ? 8 + THUMB_W + 10 : 10);
      }
      paintText(title, row.title);
      paintText(meta, row.meta);
      setThumb(row.thumb);
      setId(row.id);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[46] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-gradient-to-b from-[#058cf5] to-[#015ee6]" />
      <View class="absolute left-[10] right-0 bottom-0 h-[1] bg-[#e0e0e0]" />
      <View class={thumb() ? "absolute left-[8] top-[8] w-[64] h-[40] rounded-[4] overflow-hidden bg-[#e4e7eb]" : "hidden"}>
        <Show when={thumbKey()}>{(src) => <Image class="absolute left-0 top-0 w-[64] h-[64]" src={src()} />}</Show>
      </View>
      <View ref={textCol} class="absolute left-[10] top-[6] flex-col">
        <Text ref={title} class="text-sm text-[#111111] font-bold leading-[17]">{" "}</Text>
        <Text ref={meta} class="mt-[2] text-xs text-[#8a9099]">{" "}</Text>
      </View>
    </View>
  );
}

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press; top?: number }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  const top = () => props.top ?? 0;
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute" style={{ insetL: W / 2 - 11, insetT: top() + 40 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 text-base text-[#4c566c] font-bold text-center" style={{ insetT: top() + 74, width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: top() + 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute w-[120] h-[30] rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
                : "absolute w-[120] h-[30] rounded-[6] border border-[#9aa1aa] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
              style={{ insetL: (W - 120) / 2, insetT: top() + 160 }}
            />
            <Text class="absolute w-[120] text-sm text-[#d93a00] font-bold text-center" style={{ insetL: (W - 120) / 2, insetT: top() + 167 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

// ---- the feed page ----------------------------------------------------------------------

export function feedPage(env: RedditEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const layout = createMemo(() => postRows(env));
  const listed = () => model.feed().status === "ready" && model.feed().items.length > 0;
  const pool = createSlotPool(() => (listed() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: POST_MIN_H });
  const lit = highlight(env, layer, "post.");
  const keys = keyIndex(() => layout().rows, "post.");
  const open = (row: PostRow) => {
    model.open(row.post);
    stack.push("post");
  };
  const step = (by: number) => {
    const at = SORTS.findIndex((sort) => sort.id === model.sort());
    model.setSort(SORTS[(at + by + SORTS.length) % SORTS.length]!.id);
  };
  // Nearing the end of the list pages in the next posts; pictures the list
  // scrolled past leave the queue.
  onFrame(() => {
    if (!listed()) return;
    const offset = layer.offset();
    if (offset + VIEW_H > layout().height - MORE_H - 40) model.more();
    const keep = new Set<string>();
    for (const row of layout().rows) if (row.thumb && row.y + row.h > offset - OVERSCAN && row.y < offset + VIEW_H + OVERSCAN) keep.add(row.id);
    model.client.prunePictures(keep);
  });
  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <PostSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {model.feed().status === "error"
            ? <Centered title={model.feed().error!.title} detail={model.feed().error!.detail} button={model.feed().needsSetup ? { id: "feed.setup", label: "Set Up" } : { id: "feed.retry", label: "Try Again" }} press={press} />
            : model.feed().status === "ready"
              ? <Centered title="No Posts" detail="This list is empty right now." press={press} />
              : <Centered title="Loading" detail={`Fetching r/${toAscii(model.sub())} through ${yourComputer()}.`} spinner press={press} />}
        </Show>
        <Show when={listed() && layout().more}>
          <View class="absolute" style={{ insetL: W / 2 - 42, insetT: layout().height - MORE_H + 13 }}>
            <ClassicSpinner size={18} color={"#8a9099"} />
          </View>
          <Text class="absolute text-sm text-[#8a9099] font-bold" style={{ insetL: W / 2 - 16, insetT: layout().height - MORE_H + 13 }}>Loading...</Text>
        </Show>
      </>
    ),
    height: () => (listed() ? layout().height : VIEW_H),
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      if (model.feed().status === "error") {
        return model.feed().needsSetup
          ? [{ id: "feed.setup", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => stack.push("setup") }]
          : [{ id: "feed.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => model.reload() }];
      }
      const out: Target[] = [];
      for (const row of layout().rows) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: `post.${row.id}`, x: 0, y, w: W, h: row.h, run: () => open(row) });
      }
      return out;
    },
    span(id) {
      const row = keys().byKey.get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(id) {
      const row = keys().byKey.get(id);
      if (row) open(row);
      else if (id === "feed.retry") model.reload();
      else if (id === "feed.setup") stack.push("setup");
    },
  };
  return {
    title: () => `r/${toAscii(model.sub())}`,
    backLabel: "Posts",
    tint: "orange",
    bare: "white",
    titleView: () => <Segments env={env} />,
    right: () => ({ ...SUBS, run: () => stack.push("subs") }),
    fixedTargets: () => segmentTargets(env),
    content,
    legend: () => [
      { button: "lr", label: "Sort" },
      { button: "triangle", label: "Reload" },
      { button: "square", label: "Subs" },
    ],
    key(pressed) {
      if (pressed & BTN.LTRIGGER) step(-1);
      else if (pressed & BTN.RTRIGGER) step(1);
      else if (pressed & BTN.TRIANGLE) model.reload();
      else if (pressed & BTN.SQUARE) stack.push("subs");
      else if (pressed & BTN.CIRCLE && model.feed().status === "error") (model.feed().needsSetup ? stack.push("setup") : model.reload());
      else return false;
      return true;
    },
  };
}

// ---- the post page ----------------------------------------------------------------------

const BODY_LINE = 16;
const AUTHOR_H = 15;
const ROW_PAD = 7;
const COMMENT_MIN_H = ROW_PAD + AUTHOR_H + BODY_LINE + ROW_PAD;
const INDENT = 11;
const HEADER_X = 12;
const HEADER_TITLE_LINE = 19;
const HEADER_TEXT_LINE = 17;
const MAX_DEPTH = 5;
const DEPTH_COLORS = ["#ff8a5c", "#7fb0e8", "#8fd18f", "#d59be0", "#c9b37a"];

export interface CommentRow {
  id: string;
  depth: number;
  x: number;
  y: number;
  h: number;
  author: string;
  meta: string;
  body: string;
  op: boolean;
}

/** The post at the head of its page: every line laid out once. */
export interface PostHeader {
  title: string;
  meta: string;
  /** The link's domain, "" for a text post. */
  link: string;
  /** The text of a self post, wrapped; "" when it has none. */
  text: string;
  /** The preview picture's box height, 0 without one. */
  pictureH: number;
  pictureY: number;
  linkY: number;
  metaY: number;
  textY: number;
  h: number;
}

const bodyCache = new Map<string, { comment: Comment; width: number; lines: string[] }>();

function commentLines(comment: Comment, width: number): string[] {
  const cached = bodyCache.get(comment.id);
  if (cached && cached.comment === comment && cached.width === width) return cached.lines;
  const lines = wrap(toAscii(comment.body || "[removed]"), FONT.sm, width);
  if (bodyCache.size > 600) bodyCache.clear();
  bodyCache.set(comment.id, { comment, width, lines });
  return lines;
}

const headerCache = new Map<string, { post: Post; now: number; header: PostHeader }>();

/** The picture's drawn size: the preview scaled to the header's width. */
function pictureSize(): { w: number; h: number; scale: number } {
  const w = W - HEADER_X * 2;
  const scale = w / IMAGE.width;
  return { w, h: Math.round(IMAGE.height * scale), scale };
}

export function postHeader(post: Post, now: number): PostHeader {
  const cached = headerCache.get(post.id);
  if (cached && cached.post === post && cached.now === now) return cached.header;
  const width = W - HEADER_X * 2;
  const title = wrap(toAscii(post.title || "Untitled"), FONT.baseBold, width);
  const parts = [`r/${toAscii(post.sub)}`, `u/${toAscii(post.author)}`, `${countText(post.score)} points`];
  if (post.created) parts.push(ageText(post.created, now));
  parts.push(`${countText(post.comments)} comments`);
  const link = post.isSelf ? "" : toAscii(post.domain || post.url);
  const text = post.selftext ? wrap(toAscii(post.selftext), FONT.sm, width) : [];
  let y = 8 + title.length * HEADER_TITLE_LINE + 2;
  const metaY = y;
  y += 15;
  const linkY = y;
  if (link) y += 15;
  const pictureY = y + 8;
  const pictureH = post.preview ? pictureSize().h : 0;
  if (pictureH) y = pictureY + pictureH;
  const textY = y + 8;
  if (text.length) y = textY + text.length * HEADER_TEXT_LINE;
  const header: PostHeader = {
    title: title.join("\n"),
    meta: ellipsize(parts.join("  |  "), FONT.xs, width),
    link,
    text: text.join("\n"),
    pictureH,
    pictureY,
    linkY,
    metaY,
    textY,
    h: y + 10,
  };
  if (headerCache.size > 100) headerCache.clear();
  headerCache.set(post.id, { post, now, header });
  return header;
}

const previousComments = new Map<string, CommentRow>();

function sameComment(a: CommentRow, b: CommentRow): boolean {
  return a.depth === b.depth && a.x === b.x && a.y === b.y && a.h === b.h && a.author === b.author && a.meta === b.meta && a.op === b.op && a.body === b.body;
}

function commentRows(env: RedditEnv): { header: PostHeader | null; rows: CommentRow[]; height: number; footer: string } {
  env.model.version();
  const id = env.model.current();
  const state = id ? env.model.thread(id) : undefined;
  const post = state?.thread?.post ?? env.model.listed(id);
  const now = env.now();
  const header = post ? postHeader(post, now) : null;
  let y = header ? header.h : 0;
  const rows: CommentRow[] = (state?.thread?.comments ?? []).map((comment) => {
    const depth = Math.min(comment.depth, MAX_DEPTH);
    const x = 10 + depth * INDENT;
    const lines = commentLines(comment, W - x - 10);
    const h = ROW_PAD + AUTHOR_H + lines.length * BODY_LINE + ROW_PAD;
    const next: CommentRow = {
      id: comment.id,
      depth,
      x,
      y,
      h,
      author: toAscii(comment.author || "[deleted]"),
      meta: `${countText(comment.score)} points${comment.created ? `  ${ageText(comment.created, now)}` : ""}`,
      body: lines.join("\n"),
      op: !!post?.author && comment.author === post.author,
    };
    const before = previousComments.get(comment.id);
    const row = before && sameComment(before, next) ? before : next;
    previousComments.set(comment.id, row);
    y += h;
    return row;
  });
  if (previousComments.size > 600) previousComments.clear();
  const footer = !state || state.status === "loading"
    ? "Loading comments..."
    : state.status === "error"
      ? `${state.error!.title}. Press the triangle button to retry.`
      : rows.length === 0
        ? "No comments yet."
        : "";
  return { header, rows, height: y + (footer ? 44 : 8), footer };
}

/** One slot of the comments' pool; painted like PostSlot. */
function CommentSlot(props: { pool: SlotPool<CommentRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let frame!: NodeMirror;
  let rule!: NodeMirror;
  let author!: NodeMirror;
  let meta!: NodeMirror;
  let body!: NodeMirror;
  const [id, setId] = createSignal("");
  const lit = createMemo(() => id() !== "" && props.lit(id()));
  let op = false;
  let depth = -1;
  let y = -1;
  let h = -1;
  let x = -1;
  const recolor = () => {
    const on = lit();
    jump(wash, "opacity", on ? 1 : 0);
    jump(author, "textColor", on ? "#ffffff" : op ? "#d93a00" : "#3b4a60");
    jump(meta, "textColor", on ? "#d6e6ff" : "#a0a6ae");
    jump(body, "textColor", on ? "#ffffff" : "#222222");
  };
  onMount(() => {
    createEffect(recolor);
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [author, meta, body]) paintText(text, "");
        setId("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      if (row.x !== x) jump(frame, "insetL", (x = row.x));
      if (row.depth !== depth) {
        depth = row.depth;
        jump(rule, "opacity", depth === 0 ? 0 : 1);
        if (depth > 0) jump(rule, "bgColor", DEPTH_COLORS[depth - 1]!);
      }
      paintText(author, row.author);
      paintText(meta, row.meta);
      paintText(body, row.body);
      const recolorNow = row.op !== op;
      op = row.op;
      setId(row.id);
      if (recolorNow) recolor();
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[45] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-gradient-to-b from-[#058cf5] to-[#015ee6]" />
      <View ref={frame} class="absolute left-[10] top-0 right-0 bottom-0">
        <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e6e6e6]" />
        <View ref={rule} class="absolute left-[-6] top-[4] bottom-[4] w-[2] opacity-0 bg-[#ff8a5c]" />
        <View class="absolute left-0 top-[6] flex-row">
          <Text ref={author} class="text-xs text-[#3b4a60] font-bold">{" "}</Text>
          <Text ref={meta} class="ml-[6] text-xs text-[#a0a6ae]">{" "}</Text>
        </View>
        <Text ref={body} class="absolute left-0 top-[22] text-sm text-[#222222] leading-[16]">{" "}</Text>
      </View>
    </View>
  );
}

function Header(props: { env: RedditEnv; header: Accessor<PostHeader> }) {
  const header = props.header;
  const { model } = props.env;
  const picture = () => {
    model.client.pictures();
    return header().pictureH ? model.client.image(model.current()) : "";
  };
  const size = () => pictureSize();
  return (
    <>
      <View class="absolute left-0 top-0 bg-[#f6f7f8]" style={{ width: W, height: header().h }} />
      <View class="absolute left-0 h-[1] bg-[#e1e4e8]" style={{ insetT: header().h - 1, width: W }} />
      <Text class="absolute left-[12] top-[8] text-base text-black font-bold leading-[19]">{header().title}</Text>
      <Text class="absolute left-[12] text-xs text-[#828282]" style={{ insetT: header().metaY }}>{header().meta}</Text>
      <Show when={header().link}>
        <Text class="absolute left-[12] text-xs text-[#d93a00] font-bold" style={{ insetT: header().linkY }}>{header().link}</Text>
      </Show>
      <Show when={header().pictureH}>
        <View class="absolute left-[12] rounded-[6] overflow-hidden bg-[#e1e4e8]" style={{ insetT: header().pictureY, width: size().w, height: size().h }}>
          <Show when={picture()}>{(src) => <Image class="absolute left-0 top-0" style={{ width: Math.round(IMAGE.texture * size().scale), height: Math.round(IMAGE.texture * size().scale) }} src={src()} />}</Show>
          <Show when={!picture()}>
            <View class="absolute" style={{ insetL: size().w / 2 - 9, insetT: size().h / 2 - 9 }}>
              <ClassicSpinner size={18} color={"#8a9099"} />
            </View>
          </Show>
        </View>
      </Show>
      <Show when={header().text}>
        <Text class="absolute left-[12] text-sm text-[#222222] leading-[17]" style={{ insetT: header().textY }}>{header().text}</Text>
      </Show>
    </>
  );
}

export function postPage(env: RedditEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model } = env;
  const layout = createMemo(() => commentRows(env));
  const header = createMemo(() => layout().header);
  const pool = createSlotPool(() => layout().rows, layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: COMMENT_MIN_H });
  const lit = highlight(env, layer, "comment.");
  const keys = keyIndex(() => layout().rows, "comment.");
  const state = () => (model.current() ? model.thread(model.current()) : undefined);
  const content: PageContent = {
    view: () => (
      <>
        <Show when={header()}>{(current) => <Header env={env} header={current} />}</Show>
        <For each={pool.slots}>{(slot) => <CommentSlot pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={layout().footer}>
          <Show when={state()?.status === "loading"}>
            <View class="absolute" style={{ insetL: W / 2 - 68, insetT: layout().height - 32 }}>
              <ClassicSpinner size={16} color={"#8a9099"} />
            </View>
          </Show>
          <Text class="absolute left-0 text-xs text-[#8a9099] font-bold text-center" style={{ insetT: layout().height - 31, width: W }}>{layout().footer}</Text>
        </Show>
      </>
    ),
    height: () => layout().height,
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      const out: Target[] = [];
      for (const row of layout().rows) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: `comment.${row.id}`, x: 0, y, w: W, h: row.h });
      }
      return out;
    },
    span(id) {
      const row = keys().byKey.get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate: () => undefined,
  };
  return {
    title: () => {
      const post = model.listed(model.current());
      return post ? `r/${toAscii(post.sub)}` : "Post";
    },
    backLabel: "Post",
    tint: "orange",
    bare: "white",
    content,
    activateLabel: () => "",
    legend: () => [{ button: "triangle", label: "Reload" }],
    key(pressed) {
      if (pressed & BTN.TRIANGLE) model.reloadThread();
      else return false;
      return true;
    },
  };
}

// ---- the subreddits page ----------------------------------------------------------------

const FIELD_H = 40;

export function subsPage(env: RedditEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  model.checkSetup();
  const choose = (name: string) => {
    model.keep(name);
    model.setSub(name);
    model.clearSearch();
    stack.pop();
  };
  const sections = createMemo((): Section[] => {
    const out: Section[] = [];
    const search = model.search();
    if (search.status === "ready" && search.results.length) {
      out.push({
        header: "Found",
        cells: search.results.map((sub: Subreddit): Cell => ({
          id: `found.${sub.name}`,
          label: `r/${toAscii(sub.name)}`,
          detail: ellipsize(toAscii([sub.subscribers ? `${countText(sub.subscribers)} members` : "", sub.title].filter((part) => part).join("  ")), FONT.xs, W - 60),
          accessory: model.subs().includes(sub.name) ? "check" : "chevron",
          run: () => choose(sub.name),
        })),
      });
    } else if (search.status !== "idle") {
      out.push({
        cells: [],
        footer: search.status === "loading"
          ? `Searching for "${toAscii(search.query)}"...`
          : search.status === "error"
            ? `${search.error!.title}: ${search.error!.detail}`
            : `Nothing matched "${toAscii(search.query)}".`,
      });
    }
    const storeError = model.storeError();
    const app = model.setup();
    out.push({
      header: "Reddit App",
      cells: [{
        id: "subs.setup",
        label: app?.ready ? (app.mode === "account" ? "Signed in with a script app" : "Reading through an installed app") : "Set up an app",
        accessory: "chevron",
        run: () => stack.push("setup"),
      }],
      footer: app?.ready ? "" : "Reddit refuses anonymous requests from most proxies; an app of your own is read through instead.",
    });
    out.push({
      header: "Subreddits",
      cells: model.subs().map((name): Cell => ({
        id: `sub.${name}`,
        label: `r/${toAscii(name)}`,
        accessory: model.sub() === name ? "check" : undefined,
        ...(name === HOME_SUB ? {} : { button: { id: `drop.${name}`, label: "Remove", tone: "grey", run: () => model.drop(name) } }),
        run: () => choose(name),
      })),
      footer: model.store() === "error"
        ? `The kept subreddits could not be read: ${storeError?.detail ?? "the store did not answer"}.`
        : storeError
          ? `A change could not be saved: ${storeError.detail}`
          : "A subreddit chosen from a search is kept on this device.",
    });
    return out;
  });
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  const fieldText = () => {
    const typing = env.draft();
    const text = typing ?? model.search().query;
    return text ? ellipsize(toAscii(text), FONT.sm, W - 40) : typing !== null ? "|" : "Search subreddits";
  };
  const content: PageContent = {
    view: () => (
      <>
        <View class={press.is("subs.field") ? "absolute left-[8] top-[6] rounded-[14] border border-[#8a9099] bg-[#e4e7eb]" : "absolute left-[8] top-[6] rounded-[14] border border-[#8a9099] bg-white"} style={{ width: W - 16, height: 28 }} />
        <Text class={model.search().query || env.draft() !== null ? "absolute left-[22] top-[12] text-sm text-[#111111]" : "absolute left-[22] top-[12] text-sm text-[#8a9099]"} style={{ width: W - 40 }}>{fieldText()}</Text>
        <View class="absolute left-0" style={{ insetT: FIELD_H, width: W, height: table.height() }}>{table.view()}</View>
      </>
    ),
    height: () => FIELD_H + table.height(),
    focusOrder: () => ["subs.field", ...table.focusOrder()],
    targets(top, offset, bottom) {
      return [{ id: "subs.field", x: 8, y: top + 2 - offset, w: W - 16, h: 36, run: () => model.editQuery() }, ...table.targets(top + FIELD_H, offset, bottom)];
    },
    span(id) {
      if (id === "subs.field") return [0, FIELD_H];
      const span = table.span(id);
      return span ? [span[0] + FIELD_H, span[1] + FIELD_H] : null;
    },
    activate(id) {
      if (id === "subs.field") model.editQuery();
      else table.activate(id);
    },
  };
  return {
    title: () => "Subreddits",
    backLabel: "Subs",
    tint: "orange",
    content,
    activateLabel: () => "Open",
    legend: () => [{ button: "square", label: appletTouch() ? "Type" : "Search" }],
    key(pressed) {
      if (pressed & BTN.SQUARE) model.editQuery();
      else return false;
      return true;
    },
  };
}

// ---- the setup page ---------------------------------------------------------------------

export function setupPage(env: RedditEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press, setup } = env;
  model.checkSetup();
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion(version() + 1);
  const fields = (): SetupFields => ({ clientId: setup.clientId.trim(), clientSecret: setup.clientSecret.trim(), username: setup.username.trim(), password: setup.password.trim() });
  const connect = () => {
    if (!fields().clientId) {
      setup.message = "Enter the app's client id first.";
      bump();
      return;
    }
    setup.message = "Asking Reddit for a token...";
    bump();
    model.connect(fields()).then((failure) => {
      setup.message = failure || "Connected.";
      bump();
      if (!failure) {
        setup.password = "";
        stack.pop();
      }
    });
  };
  const forget = () => {
    model.forgetSetup().then((failure) => {
      setup.message = failure || "The app was forgotten on this device.";
      bump();
    });
  };
  const masked = (value: string) => (value ? `...${toAscii(value.slice(-4))}` : "");
  const sections = createMemo((): Section[] => {
    version();
    env.edits();
    const app = model.setup();
    const out: Section[] = [
      {
        header: "Installed App",
        cells: [{ id: "setup.clientId", label: "Client ID", value: setup.clientId ? toAscii(setup.clientId) : "The code under the app's name", run: () => setup.edit("clientId") }],
        footer: "At reddit.com/prefs/apps make an app of type \"installed app\" with any redirect URL; its client id is the short code under its name. That is all a read-only app needs.",
      },
      {
        header: "Script App (Optional)",
        cells: [
          { id: "setup.clientSecret", label: "Secret", value: masked(setup.clientSecret) || "For a script app", run: () => setup.edit("clientSecret") },
          { id: "setup.username", label: "Username", value: setup.username ? toAscii(setup.username) : "Your account", run: () => setup.edit("username") },
          { id: "setup.password", label: "Password", value: setup.password ? "********" : "Your password", run: () => setup.edit("password") },
        ],
        footer: "A script app reads as your account: its secret and your login stay on this device.",
      },
      {
        cells: [{ id: "setup.connect", label: model.connecting() ? "Connecting..." : "Connect", tone: "action", accessory: model.connecting() ? "spinner" : undefined, run: connect }],
        footer: setup.message,
      },
    ];
    if (app?.ready) {
      out.push({
        cells: [{ id: "setup.forget", label: "Forget This App", tone: "danger", run: forget }],
        footer: app.mode === "account" ? "Signed in with a script app." : "Reading through an installed app.",
      });
    }
    return out;
  });
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  return {
    title: () => "Setup",
    backLabel: "Setup",
    tint: "orange",
    content: {
      view: table.view,
      height: table.height,
      focusOrder: table.focusOrder,
      targets: table.targets,
      span: table.span,
      activate: table.activate,
    },
    activateLabel: () => "Edit",
    legend: () => [{ button: "start", label: "Connect" }],
    key(pressed) {
      if (pressed & BTN.START) connect();
      else return false;
      return true;
    },
  };
}

export const THUMB_BOX = { w: THUMB_W, h: THUMB_H, source: THUMB } as const;
export const IS_COMPACT = () => COMPACT;
