#!/usr/bin/env bun
// The editor's side of oma.pocket.nexus, from a computer holding
// ~/.config/omarchy-pocket-store (the admin token and the official key):
//
//   bun store/admin.ts pending                       what waits for review, with what each app reaches
//   bun store/admin.ts fetch <id> <version> [dir]    a pending package and icon, to read and try first
//   bun store/admin.ts list <id> <version>           puts it in the store
//   bun store/admin.ts reject <id> <version>
//   bun store/admin.ts remove <id> <version>         takes a listed version down
//   bun store/admin.ts publish <package.pocket> <icon.png> [summary]   as Pocket Nexus: listed at once
import { createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { base64url, packageFacts, sha256, signedMessage } from "./src/shared.ts";

const STORE = process.env.OMARCHY_POCKET_STORE ?? "https://oma.pocket.nexus";
const CONFIG = join(homedir(), ".config", "omarchy-pocket-store");
const token = () => readFileSync(join(CONFIG, "admin-token"), "utf8").trim();
const admin = (path: string, init: RequestInit = {}) => fetch(`${STORE}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token()}` } });
const [command, ...args] = process.argv.slice(2);

interface Pending { id: string; version: string; title: string; author: string; summary: string; hosts: string[]; services: string[]; bytes: number; package: string; icon: string }

async function pending(): Promise<Pending[]> {
  const response = await admin("/v1/admin/pending");
  if (!response.ok) throw new Error(`the store answered ${response.status}`);
  return ((await response.json()) as { versions: Pending[] }).versions;
}

async function review(state: string) {
  const [id, version] = args;
  if (!id || !version) throw new Error("name an id and a version");
  const response = await admin("/v1/admin/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, version, state }) });
  console.log(response.status, await response.text());
}

async function publish() {
  const [packagePath, iconPath, given] = args;
  if (!packagePath || !iconPath) throw new Error("usage: publish <package.pocket> <icon.png> [summary]");
  const bytes = new Uint8Array(readFileSync(packagePath));
  const icon = new Uint8Array(readFileSync(iconPath));
  const facts = packageFacts(bytes);
  if (typeof facts === "string") throw new Error(facts);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(32, 32 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true)))) as { applet?: { summary?: string } };
  const summary = given ?? manifest.applet?.summary ?? "";
  const author = "pocket-nexus";
  const key = createPrivateKey(readFileSync(join(CONFIG, "official.pem")));
  const message = signedMessage({ id: facts.id, version: facts.version, package: await sha256(bytes), icon: await sha256(icon), author, summary });
  const form = new FormData();
  form.set("package", new File([bytes], "app.pocket"));
  form.set("icon", new File([icon], "icon.png"));
  form.set("key", readFileSync(join(CONFIG, "official.pub"), "utf8").trim());
  form.set("signature", base64url(new Uint8Array(sign(null, message, key))));
  form.set("author", author);
  form.set("summary", summary);
  const response = await fetch(`${STORE}/v1/publish`, { method: "POST", body: form });
  console.log(facts.id, facts.version, response.status, await response.text());
  if (!response.ok) process.exitCode = 1;
}

switch (command) {
  case "pending":
    for (const app of await pending()) {
      console.log(`${app.id} ${app.version}  "${app.title}" by ${app.author}, ${app.bytes} bytes\n  ${app.summary}\n  hosts: ${app.hosts.join(", ") || "none"}  services: ${app.services.join(", ") || "none"}`);
    }
    break;
  case "fetch": {
    const [id, version, dir = "."] = args;
    const app = (await pending()).find((entry) => entry.id === id && entry.version === version);
    if (!app) throw new Error("no such pending version");
    mkdirSync(dir, { recursive: true });
    for (const [kind, hash, name] of [["package", app.package, `${id}-${version}.pocket`], ["icon", app.icon, `${id}-${version}.png`]] as const) {
      const response = await admin(`/v1/admin/files/${kind}/${hash}`);
      writeFileSync(join(dir, name), new Uint8Array(await response.arrayBuffer()));
      console.log(join(dir, name));
    }
    break;
  }
  case "list":
    await review("listed");
    break;
  case "reject":
    await review("rejected");
    break;
  case "remove":
    await review("removed");
    break;
  case "publish":
    await publish();
    break;
  default:
    console.log(readFileSync(import.meta.path, "utf8").split("\n").slice(1, 10).map((line) => line.slice(3)).join("\n"));
    process.exit(command ? 1 : 0);
}
