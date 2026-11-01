// What an app installed from the store may reach.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedApp, isolatedRequest, isolatedServices } from "./appstore.ts";

test("an isolated app keeps only the services that act for nobody", () => {
  expect(isolatedServices(["store", "x", "discord", "homeassistant", "podcasts", "youtube", "maps", "glyphs", "appstore"])).toEqual(["store", "maps", "glyphs"]);
});

test("its store names are its own, however it spells them, and it cannot list others'", () => {
  const a = isolatedRequest("oma.a.app", [], "https://companion.pocket/store/get?name=homeassistant");
  const b = isolatedRequest("oma.b.app", [], "https://companion.pocket/store/get?name=homeassistant");
  expect(typeof a).toBe("string");
  expect(a).not.toBe(b);
  expect(new URL(a as string).searchParams.get("name")).toMatch(/^app-[0-9a-f]{16}\/homeassistant$/);
  const nested = isolatedRequest("oma.a.app", [], "https://companion.pocket/store/set?name=../homeassistant/token") as string;
  expect(new URL(nested).searchParams.get("name")).toMatch(/^app-[0-9a-f]{16}\/\.\.\.homeassistant\.token$/);
  expect(isolatedRequest("oma.a.app", [], "https://companion.pocket/store/list")).toEqual({ refused: expect.any(String) });
});

test("it fetches only the hosts it declared, exactly", () => {
  const hosts = ["api.example.com"];
  expect(isolatedRequest("oma.a.app", hosts, "https://api.example.com/v1")).toBe("https://api.example.com/v1");
  for (const url of ["https://example.com/", "https://evil.api.example.com/", "https://api.example.com.evil.net/"]) {
    expect(isolatedRequest("oma.a.app", hosts, url)).toEqual({ refused: expect.stringContaining("not among the hosts") });
  }
});

test("a service other than store passes through to the service's own gate", () => {
  expect(isolatedRequest("oma.a.app", [], "https://companion.pocket/maps/tile?z=1&x=0&y=0")).toBe("https://companion.pocket/maps/tile?z=1&x=0&y=0");
});

test("a package is treated as installed from the store only by its record", () => {
  const home = mkdtempSync(join(tmpdir(), "appstore-"));
  try {
    const dir = join(home, ".local", "share", "omarchy-pocket", "store");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "installed.json"), JSON.stringify([{ id: "oma.a.app", file: "/x/oma.a.app.pocket", key: "k", version: "1.0.0", official: false, title: "A" }]));
    expect(installedApp(home, "/x/oma.a.app.pocket")?.official).toBe(false);
    expect(installedApp(home, "/usr/share/omarchy-pocket/applets/x.pocket")).toBeNull();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
