#!/usr/bin/env bun
// Puts what tools/build.ts built, and device/rootfs/, on a running Omarchy
// Pocket over SSH, then restarts what changed:
//
//   bun tools/deploy.ts <ssh-host> [host] [shell] [daemon] [files]
//
// With no parts named, all four go. `files` copies every file under
// device/rootfs/ (not directories) to the same path on the device, reloads
// systemd and enables omarchy-pocketd for every user. The device keeps its
// own copies of the stock firmware's modules and its NetworkManager profiles;
// this touches neither. SSH_OPTS adds options to ssh (e.g. -o HostKeyAlias=...).
import { $ } from "bun";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { OUTPUTS, SHIM_NAMES } from "./build.ts";

const ROOT = resolve(import.meta.dir, "..");
const ROOTFS = join(ROOT, "device", "rootfs");
const PARTS = ["host", "shell", "daemon", "files"] as const;
type Part = (typeof PARTS)[number];

const [target, ...named] = process.argv.slice(2);
if (!target || named.some((p) => !PARTS.includes(p as Part))) {
  console.error(`usage: bun tools/deploy.ts <ssh-host> [${PARTS.join("] [")}]`);
  process.exit(2);
}
const parts = new Set<Part>(named.length ? (named as Part[]) : PARTS);
const user = process.env.OMARCHY_POCKET_USER ?? "omarchy";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [relative(ROOTFS, path)];
  });
}

const uploads: [string, string, string][] = []; // local, remote, mode
if (parts.has("host")) uploads.push([OUTPUTS.host, "/usr/bin/omarchy-pocket-host", "755"]);
if (parts.has("shell")) uploads.push([OUTPUTS.shell, "/usr/share/pocketjs/omarchy-pocket.pocket", "644"]);
if (parts.has("daemon")) {
  uploads.push([OUTPUTS.daemon, "/usr/lib/omarchy-pocket/omarchy-pocketd.js", "644"]);
  uploads.push([OUTPUTS.wasm, "/usr/lib/omarchy-pocket/ghostty-vt.wasm", "644"]);
  for (const name of SHIM_NAMES) uploads.push([OUTPUTS.shim, `/usr/local/bin/${name}`, "755"]);
}
for (const [local] of uploads) if (!existsSync(local)) throw new Error(`${local} is missing; run: bun tools/build.ts`);

// one tar stream: each upload under its remote path, then device/rootfs/
const stage = join(ROOT, ".cache", "deploy");
await $`rm -rf ${stage} && mkdir -p ${stage}`;
for (const [local, remote, mode] of uploads) await $`mkdir -p ${join(stage, remote, "..")} && install -m ${mode} ${local} ${join(stage, remote)}`;
if (parts.has("files")) for (const file of files(ROOTFS)) await $`mkdir -p ${join(stage, file, "..")} && cp -p ${join(ROOTFS, file)} ${join(stage, file)}`;
const list = (await $`cd ${stage} && find . -type f`.text()).trim().split("\n").filter(Boolean);
console.log(list.map((f) => `  ${f.slice(1)}`).join("\n"));

const restart: string[] = [];
if (parts.has("files")) restart.push("systemctl daemon-reload", "systemctl --global enable omarchy-pocketd.service", `loginctl enable-linger ${user}`);
if (parts.has("daemon") || parts.has("files")) restart.push(`systemctl --user -M ${user}@ daemon-reload`, `systemctl --user -M ${user}@ restart omarchy-pocketd.service`);
if (parts.has("host") || parts.has("shell") || parts.has("files")) restart.push("systemctl restart omarchy-pocket.service");

const ssh = (process.env.SSH_OPTS ?? "").split(" ").filter(Boolean);
const remote = ["tar -C / -xpf -", ...restart].join(" && ");
await $`cd ${stage} && COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --uid 0 --gid 0 -cf - ${list} | ssh ${ssh} ${target} ${remote}`;
console.log(`deployed ${[...parts].join(", ")} to ${target}`);
