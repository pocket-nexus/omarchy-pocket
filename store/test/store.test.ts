// The store's rules, against the Worker under `wrangler dev` with local D1 and R2.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { base64url, packageFacts, sha256, signedMessage } from "../src/shared.ts";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "test-admin-token";
const PROFILE = "ab".repeat(32);
const state = mkdtempSync(join(tmpdir(), "store-test-"));

interface Key { public: string; sign(message: Uint8Array): string }
function newKey(): Key {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { public: base64url(new Uint8Array(raw)), sign: (message) => base64url(new Uint8Array(sign(null, message, privateKey))) };
}
const official = newKey();

/** A package with the directory a store reads. */
function pocket(manifest: object, profile = PROFILE): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestPad = Math.ceil(json.length / 16) * 16;
  const target = new TextEncoder().encode("omarchy-pocket");
  const stringsAt = 32 + manifestPad + 64;
  const out = new Uint8Array(stringsAt + target.length + 64);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x544b4350, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, json.length, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, stringsAt, true);
  view.setUint32(20, target.length, true);
  out.set(json, 32);
  const at = 32 + manifestPad;
  view.setUint32(at, 0, true);
  view.setUint32(at + 4, target.length, true);
  for (let i = 0; i < 32; i++) out[at + 32 + i] = parseInt(profile.slice(i * 2, i * 2 + 2), 16);
  out.set(target, stringsAt);
  return out;
}

function icon(side = 128): Uint8Array {
  const out = new Uint8Array(64);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(out.buffer).setUint32(16, side);
  new DataView(out.buffer).setUint32(20, side);
  return out;
}

async function publish(key: Key, manifest: object, options: { author?: string; summary?: string; side?: number; forge?: boolean } = {}) {
  const bytes = pocket({ applet: { version: 1 }, ...manifest });
  const png = icon(options.side);
  const author = options.author ?? "maker";
  const summary = options.summary ?? "Does a small thing.";
  const m = manifest as { id: string; version: string };
  const message = signedMessage({ id: m.id, version: m.version, package: await sha256(bytes), icon: await sha256(png), author, summary });
  const form = new FormData();
  form.set("package", new File([bytes as BlobPart], "a.pocket"));
  form.set("icon", new File([png as BlobPart], "icon.png"));
  form.set("key", key.public);
  form.set("signature", options.forge ? newKey().sign(message) : key.sign(message));
  form.set("author", author);
  form.set("summary", summary);
  const response = await fetch(`${BASE}/v1/publish`, { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as { error?: string; state?: string }, hash: await sha256(bytes) };
}
const review = (id: string, version: string, state: string, token = ADMIN) =>
  fetch(`${BASE}/v1/admin/review`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id, version, state }) });
const catalog = async () => ((await (await fetch(`${BASE}/v1/catalog?profile=${PROFILE}`)).json()) as { apps: { id: string; version: string }[] }).apps;

let server: ReturnType<typeof Bun.spawn>;
beforeAll(async () => {
  const cwd = resolve(import.meta.dir, "..");
  const persist = join(state, "wrangler");
  const wrangler = ["bunx", "wrangler"];
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  const migrate = Bun.spawnSync([...wrangler, "d1", "migrations", "apply", "omarchy-pocket-store", "--local", "--persist-to", persist], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (migrate.exitCode !== 0) throw new Error(migrate.stderr.toString());
  server = Bun.spawn([...wrangler, "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist, "--var", `ADMIN_TOKEN:${ADMIN}`, "--var", `OFFICIAL_KEY:${official.public}`], { cwd, env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/v1/catalog?profile=${PROFILE}`)).ok) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error("wrangler dev did not start");
}, 90_000);
afterAll(() => {
  server?.kill();
  rmSync(state, { recursive: true, force: true });
});

const manifest = (id: string, version = "1.0.0", extra: object = {}) => ({ id, title: "A", version, ...extra });

test("a package's facts come out of its directory", () => {
  const facts = packageFacts(pocket({ id: "a.b.c", title: "T", version: "1.0.0", applet: { services: ["store"], hosts: ["example.com"] } }));
  expect(facts).toMatchObject({ id: "a.b.c", services: ["store"], hosts: ["example.com"], target: "omarchy-pocket", profile: PROFILE, applet: true });
  expect(packageFacts(new Uint8Array(200))).toBe("not a .pocket package");
});

test("the official key lists at once; another key waits, and its files cannot be read until an editor lists them", async () => {
  expect((await publish(official, manifest("dev.pocket-nexus.one"), { author: "pocket-nexus" })).body.state).toBe("listed");
  expect((await catalog()).map((a) => a.id)).toContain("dev.pocket-nexus.one");

  const key = newKey();
  const first = await publish(key, manifest("io.github.maker.tool"));
  expect(first.status).toBe(201);
  expect(first.body.state).toBe("pending");
  expect((await catalog()).map((a) => a.id)).not.toContain("io.github.maker.tool");
  expect((await fetch(`${BASE}/v1/packages/${first.hash}`)).status).toBe(404);

  expect((await review("io.github.maker.tool", "1.0.0", "listed", "wrong")).status).toBe(401);
  expect((await fetch(`${BASE}/v1/admin/pending`)).status).toBe(401);
  expect((await review("io.github.maker.tool", "1.0.0", "listed")).status).toBe(200);
  expect((await catalog()).map((a) => a.id)).toContain("io.github.maker.tool");
  expect((await fetch(`${BASE}/v1/packages/${first.hash}`)).status).toBe(200);

  expect((await review("io.github.maker.tool", "1.0.0", "removed")).status).toBe(200);
  expect((await catalog()).map((a) => a.id)).not.toContain("io.github.maker.tool");
  expect((await fetch(`${BASE}/v1/packages/${first.hash}`)).status).toBe(404);
});

test("an id and an author belong to the first key; a version must be newer; a signature must be the key's", async () => {
  const owner = newKey();
  const thief = newKey();
  expect((await publish(owner, manifest("io.github.owner.app"), { author: "owner" })).status).toBe(201);
  expect((await publish(thief, manifest("io.github.owner.app", "2.0.0"), { author: "thief" })).status).toBe(409);
  expect((await publish(thief, manifest("io.github.thief.app"), { author: "owner" })).status).toBe(409);
  expect((await publish(owner, manifest("io.github.owner.other"), { author: "other-name" })).status).toBe(409);
  expect((await publish(owner, manifest("io.github.owner.app", "1.0.0"), { author: "owner" })).status).toBe(409);
  expect((await publish(owner, manifest("io.github.owner.app", "1.0.1"), { author: "owner" })).status).toBe(201);
  expect((await publish(newKey(), manifest("io.github.forged.app"), { author: "forged", forge: true })).status).toBe(401);
});

test("an app from the store cannot name reserved ids or the services that act as the owner", async () => {
  const key = newKey();
  expect((await publish(key, manifest("dev.pocket-nexus.fake"), { author: "faker" })).status).toBe(403);
  expect((await publish(key, manifest("io.github.faker.a"), { author: "pocket-nexus-fan" })).status).toBe(403);
  const x = await publish(key, { ...manifest("io.github.faker.b"), applet: { services: ["x"] } }, { author: "faker" });
  expect(x.status).toBe(403);
  expect(x.body.error).toContain("x");
  expect((await publish(key, manifest("io.github.faker.c"), { author: "faker", side: 64 })).status).toBe(400);
});
