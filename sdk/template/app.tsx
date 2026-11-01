// TEMPLATE: __TITLE__ as a list and a detail page. Replace this with what the app
// does, and delete this line. ../kit/README.md has every row and a recipe for each
// common page; ../examples/github is a large app built the same way.
import { createApp, ICONS, listPage, type App, type LayerContext } from "../kit/app.tsx";
import { pageId, pageParts, plural, queryRows } from "../kit/page.ts";

interface Thing {
  id: string;
  name: string;
  about: string;
  parts: number;
}

/** Data comes from here. From the network:
 *    const reply = await fetch("https://api.example.com/things"); // fetch from ../lib/net.ts
 *    return reply.json<Thing[]>();
 *  and add the host to applet.hosts in pocket.json. */
async function loadThings(): Promise<Thing[]> {
  return [
    { id: "one", name: "First thing", about: "What a row says about it, in a line or two.", parts: 1 },
    { id: "two", name: "Second thing", about: "A longer detail wraps, and is cut at the lines the row allows.", parts: 12 },
  ];
}

function homePage(app: App, layer: LayerContext) {
  const things = app.queries.query("things", loadThings);
  return listPage(app, layer, {
    title: "__TITLE__",
    rows: (rows) => queryRows(rows, "things", things, (list) => [
      rows.section("Things"),
      ...list.map((thing) => rows.cell({
        key: thing.id,
        icon: ICONS.file.muted,
        title: thing.name,
        detail: thing.about,
        trailing: String(thing.parts),
        run: () => app.stack.push(pageId("thing", thing.id)),
      })),
    ]),
  });
}

function thingPage(app: App, layer: LayerContext, id: string) {
  const things = app.queries.query("things", loadThings);
  return listPage(app, layer, {
    title: "Thing",
    rows: (rows) => queryRows(rows, "thing", things, (list) => {
      const thing = list.find((entry) => entry.id === id);
      if (!thing) return rows.message({ key: "gone", title: "This is gone" });
      return [
        rows.cell({ key: "head", big: true, icon: ICONS.file.muted, title: thing.name, detail: plural(thing.parts, "part") }),
        ...rows.strip([
          { id: "thing.note", label: "Add Note", icon: ICONS.plus.text, tone: "button", run: () => app.compose({ title: "Note", placeholder: "Your note", action: "Save", send: async () => app.say("Saved") }) },
        ], "actions"),
        rows.section("About"),
        ...rows.text(thing.about, "body", "about"),
      ];
    }),
  });
}

export default createApp({
  name: "__NAME__",
  root: "home",
  page(id, app, layer) {
    const [kind, a = ""] = pageParts(id);
    switch (kind) {
      case "thing": return thingPage(app, layer, a);
      default: return homePage(app, layer);
    }
  },
});
