import { describe, expect, test } from "bun:test";
import { createMockNet, findRoute, mockErrors, urlMatches, type MockData } from "./mock.ts";

const settle = async (net: ReturnType<typeof createMockNet>) => {
  await new Promise((r) => setTimeout(r, 120));
  net.beginFrame();
  return JSON.parse(net.ns.poll() ?? "[]") as { t: string; h: number; status?: number; bytes?: number; code?: string; headers?: Record<string, string> }[];
};
const body = (net: ReturnType<typeof createMockNet>, handle: number, bytes: number) => {
  const into = new ArrayBuffer(bytes);
  expect(net.ns.take(handle, into)).toBe(bytes);
  return net.ns.decode(into);
};
const meta = (url: string, method = "GET") => JSON.stringify({ url, method, headers: {}, timeoutMs: 10_000, maxBytes: 65536 });

describe("sample data", () => {
  test("a pattern's * stands for any run of characters", () => {
    expect(urlMatches("https://a.test/x", "https://a.test/x")).toBe(true);
    expect(urlMatches("https://a.test/x", "https://a.test/xy")).toBe(false);
    expect(urlMatches("https://a.test/v1/forecast?*", "https://a.test/v1/forecast?latitude=35.6&longitude=139.7")).toBe(true);
    expect(urlMatches("https://a.test/*/item/*.json", "https://a.test/v0/item/42.json")).toBe(true);
    expect(urlMatches("https://a.test/*/item/*.json", "https://a.test/v0/user/42.json")).toBe(false);
    expect(urlMatches("https://a.test/*x*x", "https://a.test/x")).toBe(false);
  });

  test("routes are tried in order, by method", () => {
    const data: MockData = { mock: 1, routes: [{ method: "POST", url: "https://a.test/*", text: "post" }, { url: "https://a.test/one", text: "one" }, { method: "*", url: "https://a.test/*", text: "any" }] };
    expect(findRoute(data, "GET", "https://a.test/one")?.text).toBe("one");
    expect(findRoute(data, "POST", "https://a.test/one")?.text).toBe("post");
    expect(findRoute(data, "DELETE", "https://a.test/two")?.text).toBe("any");
    expect(findRoute(data, "GET", "https://b.test/")).toBeNull();
  });

  test("the NET ops answer a route, the store service and nothing else", async () => {
    const heard: string[] = [];
    const net = createMockNet(
      { mock: 1, store: { weather: { units: "c" } }, routes: [{ url: "https://a.test/forecast?*", text: '{"t":14}', headers: { "Content-Type": "application/json" }, delay: 5 }] },
      { request: (n) => heard.push(`${n.method} ${n.url} ${n.answer ?? "-"} ${n.status}`) },
    );
    const forecast = net.ns.start(meta("https://a.test/forecast?lat=1"), new ArrayBuffer(0));
    const saved = net.ns.start(meta("https://companion.pocket/store/get?name=weather"), new ArrayBuffer(0));
    expect(net.ns.start(meta("https://a.test/third"), new ArrayBuffer(0))).toBe(-1);
    expect(net.ns.lastError()).toStartWith("busy");
    // nothing shows before a frame begins
    expect(net.ns.poll()).toBeUndefined();
    const events = await settle(net);
    const done = new Map(events.map((e) => [e.h, e]));
    expect(done.get(forecast)?.status).toBe(200);
    expect(done.get(forecast)?.headers?.["content-type"]).toBe("application/json");
    expect(body(net, forecast, done.get(forecast)!.bytes!)).toBe('{"t":14}');
    expect(JSON.parse(body(net, saved, done.get(saved)!.bytes!))).toEqual({ value: { units: "c" } });

    const set = net.ns.start(meta("https://companion.pocket/store/set?name=weather", "POST"), net.ns.encode('{"units":"f"}'));
    const missing = net.ns.start(meta("https://b.test/nothing"), new ArrayBuffer(0));
    const later = new Map((await settle(net)).map((e) => [e.h, e]));
    expect(later.get(set)?.status).toBe(200);
    expect(later.get(missing)).toMatchObject({ t: "error", code: "connect" });
    expect(net.store()).toEqual({ weather: { units: "f" } });
    expect(heard).toContain("GET https://b.test/nothing - 0");
    expect(heard).toContain("GET https://a.test/forecast?lat=1 route 200");
  });

  test("malformed sample data says what is wrong", () => {
    expect(mockErrors({ mock: 1, routes: [] })).toEqual([]);
    expect(mockErrors({ routes: [{ url: "ftp://x", method: "FETCH", status: 9 }] })).toEqual([
      "sample data says mock: 1",
      "routes[0].url is an http(s) URL pattern",
      "routes[0].method is one of GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS or *",
      "routes[0].status is 100 to 599",
    ]);
  });
});
