# The design system

`applets/kit` is how an applet looks and behaves. **A page says what it shows and the kit draws it**: the measuring, spacing, colours, touch, keyboard focus, loading, scrolling and text for any script are here, so applets made with it look like one family.

`../github` is a full app built only from this. Read `app.tsx` there for the routing and `pages/repo.tsx` for pages of every kind.

## An app

```tsx
import { createApp, ICONS, listPage, type App, type LayerContext } from "../kit/app.tsx";
import { pageId, pageParts, queryRows } from "../kit/page.ts";

export default createApp({
  name: "notes",          // pages and scroll positions outlive a resize under this name
  root: "home",
  page(id, app, layer) {  // the stack calls this with a page's id
    const [kind, a = ""] = pageParts(id);
    switch (kind) {
      case "note": return notePage(app, layer, a);
      default: return homePage(app, layer);
    }
  },
});
```

`main.tsx` stays as the template writes it. `app.stack.push(pageId("note", id))` opens a page; the bar's back button and the Cross button (Backspace on a keyboard) pop it.

## A page

`listPage(app, layer, options)` is one scrolling list of rows under the bar.

| Option | What it is |
|---|---|
| `title` | one or two words; a string or an accessor |
| `rows: (rows) => Row[]` | the page; it reruns when a signal it reads changes |
| `right` | one button in the bar: `() => ({ id: "x.search", label: "Search", kind: "plain", run })` |
| `tabs` | a bottom tab bar, 3 to 5 tabs, on the first page only: `{ items, current, select }`; each tab has `id`, `label`, `icon`, `on` |
| `loading` | a page with no rows shows a spinner while this holds, and always when it is absent |
| `onEnd` | the reader is near the end: pass a paged list's `more` |
| `backLabel` | what the back button says on the page above this one |

`linesPage(app, layer, { title, lines })` is monospace text with a gutter, for code and logs: each line is `{ gutter, text, tone }`, tone `plain`, `add`, `del`, `hunk` or `file`.

## Rows

| Need | Row |
|---|---|
| An item in a list | `rows.cell({ key, title, detail, icon, trailing, run })` |
| The head of a detail page | `rows.cell({ key, big: true, avatar or icon, title, eyebrow, detail })` |
| A heading between groups | `rows.section("Files")` |
| Paragraphs | `...rows.text(value, "body", key)`; styles `h1 h2 h3 body small quote code li` |
| Markdown | `...markdownRows(rows, source, key)` |
| Filters | `...rows.strip([{ id, label, tone: on ? "chipOn" : "chip", run }], key)` |
| Actions on a thing | `...rows.strip([{ id, label, icon, tone: "button", run }], key)` |
| Figures | `...rows.strip([{ label: "3 forks", icon, tone: "stat" }], key)` |
| Empty, signed out, failed | `...rows.message({ key, title, detail, action: { label, run } })` |
| A gap | `rows.space(12, key)` |

`text`, `strip` and `message` return arrays: spread them. `key` is unique on the page and stays the same for the same item.

**A cell's parts each have one job:**

- `title`: what it is. Two lines at most; `titleLines: 1` in a dense list.
- `eyebrow`: where it belongs, above the title (`cli/cli #142`).
- `detail`: one or two facts; `detailLines` for more.
- `trailing`: one short value at the right edge: `age(date)`, a count. Never a sentence.
- `icon`: its kind or its state, `ICONS.branch.muted`, `ICONS["check-circle"].green`. Or `avatar: url`, a person, a round picture through the `images` service.
- `pills`: labels, `{ text, color: "d73a4a" }`, hex without the #.
- `unread`: a dot. `run`: makes it tappable, and a chevron shows; `chevron: false` for a row that acts in place.

## Data

```ts
const item = app.queries.query(`item.${id}`, () => loadItem(id));   // one answer
rows: (rows) => queryRows(rows, "item", item, (value) => [ ... ]),   // spinner, failure with a retry, or the rows

const list = app.queries.paged(`list.${filter()}`, (next) => loadPage(next)); // { items, next }
rows: (rows) => pagedRows(rows, "list", list, (entry) => rows.cell({ ... }), { title: "Nothing here yet" }),
onEnd: list.more,
```

A query is kept by its key, so going back does not reload. **Name every piece of a request in the key**, and after a write call `app.queries.invalidate("list.")`. Both helpers are in `page.ts`, with `pageId`, `pageParts`, `age`, `count`, `plural` and `write`.

## Asking and telling

| Need | Call |
|---|---|
| A typed value | `app.compose({ title, placeholder, action: "Save", singleLine, secret, initial, send: async (text) => { ... } })`. A rejection shows on the sheet, with the text kept |
| Confirm something that cannot be undone | `app.confirm({ title, message, action: "Delete", danger: true, run })`. Name what the button does, never "OK" |
| How a write went | `write(app, job, "Saved", then)`, or `app.say("Saved")` and `app.say(message, true)` |

A search is a page with a row that opens `compose`: `applets/github/pages/people.tsx`, `searchPage`.

## Icons

`ICONS.<name>.<colour>` from `../kit/app.tsx`, each in the colours `icons.ts` lists:

`issue-open issue-closed issue-skip pr-open pr-merged pr-closed pr-draft repo star star-fill fork commit branch tag check check-circle x-circle dot-run clock bell search file folder play gear comment person code lock eye plus chevron back mail gist`

The compiler bakes the images a bundle names, so use `ICONS.x.y` itself, not a name built at run time. `muted` is the default in a list; a colour means a state (green good, red failed, yellow running, purple done). `accent` is for what is selected.

## What the kit does that you do not write

- **Any script:** CJK, emoji and accents are drawn through the `glyphs` service. Do not `toAscii` anything.
- **Long lists:** rows off screen are not drawn, so 10,000 rows cost what 20 do. Do not paginate for drawing.
- **Input:** touch, the pointer, two-finger scroll and the d-pad all work on every row and strip item.
- **A resize:** the app remounts; pages, scroll positions and queries are kept. State of your own goes in `keep("name", () => value)` from `../ui/keep.ts`.

## A page that looks right

1. **One thing per page.** A list, or one item's detail. A page with a list and a form is two pages.
2. **Lists first.** The first page shows the reader's data, not a welcome, a menu or a settings form.
3. **At most one strip of actions**, under the head. The action used most comes first; a destructive one goes last, with `danger` on its `confirm`.
4. **Words from the reader's side:** "New Issue", "Sign In", "Try Again". Title case on buttons, sentence case in sentences. No "Error:", no "null", no JSON, no raw status codes as the only message.
5. **Every state is designed:** first load, empty (with what to do next), failed (with a retry), signed out.
6. **Nothing shown that a person cannot use:** no ids, no URLs as content, no 40-character hashes (first 7), no ISO dates (`age`), no `undefined`, no empty sections.

## When rows are not enough

A game, a map or a canvas draws its own pixels. That file opens with

```ts
// pocket-applet: draws its own pixels because <the reason>
```

and uses `@pocketjs/framework/components` directly; `../examples/maps` is one. An app's ordinary pages stay rows.
