// The store behind oma.pocket.nexus.
//
//   GET  /v1/catalog?profile=<hex>   the newest listed version of every app built for that profile
//   GET  /v1/apps                    the newest listed version of every app, for the website
//   GET  /v1/apps/<id>               one app's newest listed version
//   GET  /v1/apps/<id>/versions      every listed version of one app, newest first
//   GET  /v1/packages/<sha256>       a listed version's package
//   GET  /v1/manifests/<sha256>      a listed package's manifest and directory (variants, sections)
//   GET  /v1/icons/<sha256>          a listed version's 128 px PNG
//   GET  /v1/mocks/<sha256>          a listed version's sample data, for the website's player
//   POST /v1/publish                 form: package, icon, key, signature, author, summary[, mock]
//   GET  /v1/admin/pending           Bearer ADMIN_TOKEN: what waits for an editor
//   POST /v1/admin/review            Bearer ADMIN_TOKEN: {id, version, state}
//   POST /v1/admin/mock              Bearer ADMIN_TOKEN: {id, version, mock}: a version's sample data
//   POST /v1/admin/backfill          Bearer ADMIN_TOKEN: each version's target read again from its package
//
// A publisher is an ed25519 key: the first to publish an app id owns it, and
// every later version must be signed by the same key. A version from the
// official key is listed at once; any other waits until an editor lists it,
// and nothing unlisted can be downloaded. The store never runs what it holds:
// the device checks the signature and asks before it installs (daemon/appstore.ts).
// The website runs a package in a sandboxed frame with no network (store/play),
// against the version's sample data; the sample data is not signed, and an
// editor reads it with the rest of a pending version.
import {
  DIRECTORY_HEAD, HANDLE, HOST, ICON_MAX, ICON_SIDE, ID, OPEN_SERVICES, PACKAGE_MAX, RESERVED_HANDLE, RESERVED_ID, SUMMARY_MAX, TITLE_MAX,
  describePackage, packageFacts, sha256, signatureValid, versionOrder,
} from "./shared.ts";
import { MOCK_MAX_BYTES, mockErrors } from "../../applets/lib/mock.ts";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  OFFICIAL_KEY: string;
  ADMIN_TOKEN: string;
}

const PUBLISHES_PER_DAY = 20;
const PENDING_PER_KEY = 5;

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...headers } });
const refuse = (status: number, error: string) => json({ error }, status);

interface VersionRow {
  id: string; version: string; title: string; summary: string; author: string; key: string; services: string; hosts: string;
  profile: string; target: string; package: string; icon: string; bytes: number; signature: string; state: string; created: number; mock: string;
}

const entry = (row: VersionRow, official: string) => ({
  id: row.id,
  version: row.version,
  title: row.title,
  summary: row.summary,
  author: row.author,
  key: row.key,
  official: row.key === official,
  services: JSON.parse(row.services) as string[],
  hosts: JSON.parse(row.hosts) as string[],
  profile: row.profile,
  package: row.package,
  icon: row.icon,
  bytes: row.bytes,
  signature: row.signature,
  created: row.created,
  target: row.target,
  mock: row.mock || null,
});

async function catalog(env: Env, url: URL): Promise<Response> {
  const profile = url.searchParams.get("profile") ?? "";
  if (!/^[0-9a-f]{64}$/.test(profile)) return refuse(400, "catalog needs the device's profile hash");
  const { results } = await env.DB.prepare(
    `SELECT v.* FROM versions v
     JOIN (SELECT id, MAX(sort) AS top FROM versions WHERE state = 'listed' AND profile = ?1 GROUP BY id) t ON t.id = v.id AND t.top = v.sort
     WHERE v.state = 'listed' AND v.profile = ?1 ORDER BY v.title COLLATE NOCASE`,
  ).bind(profile).all<VersionRow>();
  return json({ apps: results.map((row) => entry(row, env.OFFICIAL_KEY)) }, 200, { "cache-control": "public, max-age=60" });
}

async function everyApp(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT v.* FROM versions v
     JOIN (SELECT id, MAX(sort) AS top FROM versions WHERE state = 'listed' GROUP BY id) t ON t.id = v.id AND t.top = v.sort
     ORDER BY v.title COLLATE NOCASE`,
  ).all<VersionRow>();
  return json({ apps: results.map((row) => entry(row, env.OFFICIAL_KEY)) }, 200, { "cache-control": "public, max-age=60" });
}

async function versionsOf(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE id = ?1 AND state = 'listed' ORDER BY sort DESC").bind(id).all<VersionRow>();
  if (!results.length) return refuse(404, "no listed app with that id");
  return json({ versions: results.map((row) => entry(row, env.OFFICIAL_KEY)) }, 200, { "cache-control": "public, max-age=60" });
}

async function app(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM versions WHERE id = ?1 AND state = 'listed' ORDER BY sort DESC LIMIT 1").bind(id).first<VersionRow>();
  return row ? json(entry(row, env.OFFICIAL_KEY), 200, { "cache-control": "public, max-age=60" }) : refuse(404, "no listed app with that id");
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const CONTENT_TYPES = { package: "application/octet-stream", icon: "image/png", mock: "application/json" } as const;

/** A listed version's file by its hash. The hash names the bytes, so it is cached for good. */
async function file(env: Env, kind: "package" | "icon" | "mock", hash: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return refuse(400, "a file is named by its SHA-256");
  const listed = await env.DB.prepare(`SELECT 1 FROM versions WHERE ${kind} = ?1 AND state = 'listed' LIMIT 1`).bind(hash).first();
  if (!listed) return refuse(404, "no listed version has that file");
  const object = await env.FILES.get(`${kind}/${hash}`);
  if (!object) return refuse(404, "the file is missing");
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[kind],
      "content-length": String(object.size),
      "cache-control": IMMUTABLE,
      "access-control-allow-origin": "*",
    },
  });
}

/** The head of a stored package, enough for its directory. */
async function packageHead(env: Env, hash: string): Promise<Uint8Array | null> {
  let length = DIRECTORY_HEAD;
  for (let tries = 0; tries < 3; tries++) {
    const object = await env.FILES.get(`package/${hash}`, { range: { offset: 0, length } });
    if (!object) return null;
    const head = new Uint8Array(await object.arrayBuffer());
    const described = describePackage(head);
    if (typeof described === "string" || !("more" in described) || head.length < length) return head;
    length = described.more;
  }
  return null;
}

/** A listed package's manifest and its directory: what it asks of a device. */
async function manifest(env: Env, hash: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return refuse(400, "a package is named by its SHA-256");
  const listed = await env.DB.prepare("SELECT 1 FROM versions WHERE package = ?1 AND state = 'listed' LIMIT 1").bind(hash).first();
  if (!listed) return refuse(404, "no listed version has that package");
  const head = await packageHead(env, hash);
  if (!head) return refuse(404, "the package is missing");
  const described = describePackage(head);
  if (typeof described === "string" || "more" in described) return refuse(500, typeof described === "string" ? described : "the package's directory is too long");
  return json(described, 200, { "cache-control": IMMUTABLE });
}

/** Packed sample data as the store takes it, or the reason it does not. */
function readMock(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MOCK_MAX_BYTES) return `sample data is limited to ${MOCK_MAX_BYTES / 1048576} MiB`;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return "the sample data is not JSON";
  }
  const errors = mockErrors(value);
  return errors.length ? `the sample data: ${errors.slice(0, 3).join("; ")}` : null;
}

function pngSide(bytes: Uint8Array): [number, number] | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

async function publish(request: Request, env: Env): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > PACKAGE_MAX + ICON_MAX + MOCK_MAX_BYTES + 8192) return refuse(413, `a package is limited to ${PACKAGE_MAX / 1024 / 1024} MiB`);
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = Math.floor(Date.now() / 86_400_000);
  const count = await env.DB.prepare("SELECT count FROM publish_counts WHERE day = ?1 AND address = ?2").bind(day, address).first<number>("count");
  if ((count ?? 0) >= PUBLISHES_PER_DAY) return refuse(429, `at most ${PUBLISHES_PER_DAY} publishes a day from one address`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, "publish takes a multipart form");
  }
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const packageFile = form.get("package");
  const iconFile = form.get("icon");
  if (!(packageFile instanceof File) || !(iconFile instanceof File)) return refuse(400, "publish needs a package and an icon");
  if (packageFile.size > PACKAGE_MAX) return refuse(413, `a package is limited to ${PACKAGE_MAX / 1024 / 1024} MiB`);
  if (iconFile.size > ICON_MAX) return refuse(413, `an icon is limited to ${ICON_MAX / 1024} KiB`);
  const mockFile = form.get("mock");
  if (mockFile !== null && !(mockFile instanceof File)) return refuse(400, "mock is a file");
  const [bytes, icon, mock] = await Promise.all([
    packageFile.arrayBuffer().then((b) => new Uint8Array(b)),
    iconFile.arrayBuffer().then((b) => new Uint8Array(b)),
    mockFile ? mockFile.arrayBuffer().then((b) => new Uint8Array(b)) : null,
  ]);
  const mockProblem = mock ? readMock(mock) : null;
  if (mockProblem) return refuse(400, mockProblem);
  const side = pngSide(icon);
  if (!side || side[0] !== ICON_SIDE || side[1] !== ICON_SIDE) return refuse(400, `the icon must be a ${ICON_SIDE} x ${ICON_SIDE} PNG`);

  const facts = packageFacts(bytes);
  if (typeof facts === "string") return refuse(400, facts);
  const key = text("key");
  const signature = text("signature");
  const author = text("author");
  const summary = text("summary").trim();
  const official = key === env.OFFICIAL_KEY;
  if (!facts.applet) return refuse(400, "the package is not an applet");
  if (!ID.test(facts.id)) return refuse(400, "the id must look like io.github.you.name, in lower case");
  const order = versionOrder(facts.version);
  if (order === null) return refuse(400, "the version must be major.minor.patch");
  if (!facts.title || facts.title.length > TITLE_MAX) return refuse(400, `the title must be 1 to ${TITLE_MAX} characters`);
  if (!summary || summary.length > SUMMARY_MAX) return refuse(400, `the summary must be 1 to ${SUMMARY_MAX} characters`);
  if (!HANDLE.test(author)) return refuse(400, "the author must be 2 to 30 lower-case letters, digits or dashes");
  if (!official && (RESERVED_ID.test(facts.id) || RESERVED_HANDLE.test(author))) return refuse(403, "that id or author name is reserved");
  if (facts.hosts.some((host) => !HOST.test(host))) return refuse(400, "applet.hosts must name plain host names");
  if (!official) {
    const closed = facts.services.filter((service) => !(OPEN_SERVICES as readonly string[]).includes(service));
    if (closed.length) return refuse(403, `an app from the store cannot use ${closed.join(", ")}: these services act as the device's owner`);
  }
  const packageHash = await sha256(bytes);
  const iconHash = await sha256(icon);
  if (!(await signatureValid(key, signature, { id: facts.id, version: facts.version, package: packageHash, icon: iconHash, author, summary }))) {
    return refuse(401, "the signature does not match the key");
  }

  const publisher = await env.DB.prepare("SELECT key, handle FROM publishers WHERE key = ?1 OR handle = ?2").bind(key, author).all<{ key: string; handle: string }>();
  if (publisher.results.some((row) => row.handle === author && row.key !== key)) return refuse(409, `the author name ${author} belongs to another key`);
  const known = publisher.results.find((row) => row.key === key);
  if (known && known.handle !== author) return refuse(409, `this key publishes as ${known.handle}`);
  const owner = await env.DB.prepare("SELECT key FROM apps WHERE id = ?1").bind(facts.id).first<string>("key");
  if (owner && owner !== key) return refuse(409, `the id ${facts.id} belongs to another key`);
  const newest = await env.DB.prepare("SELECT MAX(sort) AS top FROM versions WHERE id = ?1").bind(facts.id).first<number>("top");
  if (newest !== null && newest !== undefined && order <= newest) return refuse(409, "the version must be newer than the last one published");
  if (!official) {
    const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM versions WHERE key = ?1 AND state = 'pending'").bind(key).first<number>("n");
    if ((waiting ?? 0) >= PENDING_PER_KEY) return refuse(429, `at most ${PENDING_PER_KEY} versions from one key can wait for review`);
  }

  const mockHash = mock ? await sha256(mock) : "";
  await env.FILES.put(`package/${packageHash}`, bytes);
  await env.FILES.put(`icon/${iconHash}`, icon);
  if (mock) await env.FILES.put(`mock/${mockHash}`, mock);
  const now = Date.now();
  const state = official ? "listed" : "pending";
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO publishers (key, handle, created) VALUES (?1, ?2, ?3)").bind(key, author, now),
    env.DB.prepare("INSERT OR IGNORE INTO apps (id, key, created) VALUES (?1, ?2, ?3)").bind(facts.id, key, now),
    env.DB.prepare(
      `INSERT INTO versions (id, version, sort, title, summary, author, key, services, hosts, profile, target, package, icon, bytes, signature, state, created, mock)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
    ).bind(facts.id, facts.version, order, facts.title, summary, author, key, JSON.stringify(facts.services), JSON.stringify(facts.hosts), facts.profile, facts.target, packageHash, iconHash, bytes.length, signature, state, now, mockHash),
    env.DB.prepare("INSERT INTO publish_counts (day, address, count) VALUES (?1, ?2, 1) ON CONFLICT (day, address) DO UPDATE SET count = count + 1").bind(day, address),
  ]);
  return json({ id: facts.id, version: facts.version, state }, 201);
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const given = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const wanted = new TextEncoder().encode(`Bearer ${env.ADMIN_TOKEN ?? ""}`);
  if (!env.ADMIN_TOKEN || given.byteLength !== wanted.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, wanted);
}

async function admin(request: Request, env: Env, path: string): Promise<Response> {
  if (!(await authorized(request, env))) return refuse(401, "an editor's token is needed");
  if (path === "/v1/admin/pending" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM versions WHERE state = 'pending' ORDER BY created").all<VersionRow>();
    return json({ versions: results.map((row) => entry(row, env.OFFICIAL_KEY)) });
  }
  if (path === "/v1/admin/review" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { id?: string; version?: string; state?: string } | null;
    if (!body?.id || !body.version || !["listed", "rejected", "removed", "pending"].includes(body.state ?? "")) return refuse(400, "review takes {id, version, state}");
    const done = await env.DB.prepare("UPDATE versions SET state = ?1 WHERE id = ?2 AND version = ?3").bind(body.state, body.id, body.version).run();
    return done.meta.changes ? json({ id: body.id, version: body.version, state: body.state }) : refuse(404, "no such version");
  }
  if (path === "/v1/admin/mock" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { id?: string; version?: string; mock?: unknown } | null;
    if (!body?.id || !body.version) return refuse(400, "mock takes {id, version, mock}");
    const row = await env.DB.prepare("SELECT 1 FROM versions WHERE id = ?1 AND version = ?2").bind(body.id, body.version).first();
    if (!row) return refuse(404, "no such version");
    if (body.mock === null) {
      await env.DB.prepare("UPDATE versions SET mock = '' WHERE id = ?1 AND version = ?2").bind(body.id, body.version).run();
      return json({ id: body.id, version: body.version, mock: null });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(body.mock));
    const problem = readMock(bytes);
    if (problem) return refuse(400, problem);
    const hash = await sha256(bytes);
    await env.FILES.put(`mock/${hash}`, bytes);
    await env.DB.prepare("UPDATE versions SET mock = ?1 WHERE id = ?2 AND version = ?3").bind(hash, body.id, body.version).run();
    return json({ id: body.id, version: body.version, mock: hash });
  }
  if (path === "/v1/admin/backfill" && request.method === "POST") {
    const { results } = await env.DB.prepare("SELECT id, version, package, target FROM versions").all<{ id: string; version: string; package: string; target: string }>();
    const changed: string[] = [];
    for (const row of results) {
      const head = await packageHead(env, row.package);
      const described = head ? describePackage(head) : null;
      const target = described && typeof described !== "string" && !("more" in described) ? described.variants[0]?.target : undefined;
      if (target && target !== row.target) {
        await env.DB.prepare("UPDATE versions SET target = ?1 WHERE id = ?2 AND version = ?3").bind(target, row.id, row.version).run();
        changed.push(`${row.id} ${row.version}`);
      }
    }
    return json({ changed });
  }
  // An editor reads a pending package before listing it.
  const pendingFile = /^\/v1\/admin\/files\/(package|icon|mock)\/([0-9a-f]{64})$/.exec(path);
  if (pendingFile && request.method === "GET") {
    const object = await env.FILES.get(`${pendingFile[1]}/${pendingFile[2]}`);
    return object ? new Response(object.body) : refuse(404, "no such file");
  }
  return refuse(404, "no such admin route");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/v1/admin/")) return await admin(request, env, path);
      if (path === "/v1/publish" && request.method === "POST") return await publish(request, env);
      if (request.method !== "GET" && request.method !== "HEAD") return refuse(405, "this route only reads");
      if (path === "/v1/catalog") return await catalog(env, url);
      if (path === "/v1/apps") return await everyApp(env);
      const history = /^\/v1\/apps\/([^/]+)\/versions$/.exec(path);
      if (history) return await versionsOf(env, history[1]!);
      const named = /^\/v1\/(apps|packages|icons|mocks|manifests)\/([^/]+)$/.exec(path);
      if (named) {
        const [, kind, name] = named;
        if (kind === "apps") return await app(env, name!);
        if (kind === "manifests") return await manifest(env, name!);
        return await file(env, kind === "icons" ? "icon" : kind === "mocks" ? "mock" : "package", name!);
      }
      if (path.startsWith("/v1/")) return refuse(404, "no such route");
      return env.ASSETS.fetch(request);
    } catch (failure) {
      console.error(failure);
      return refuse(500, "the store failed");
    }
  },
};
