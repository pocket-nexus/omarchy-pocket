// What the store, the device's daemon and `pocket-applet publish` agree on:
// the bytes a publisher signs, and what a store reads out of a `.pocket`.

export const SIGNED_PREFIX = "omarchy-pocket-store/1";

export interface SignedFields {
  id: string;
  version: string;
  /** SHA-256 of the package, hex. */
  package: string;
  /** SHA-256 of the 128 px PNG icon, hex. */
  icon: string;
  author: string;
  summary: string;
}

/** The text a publisher's key signs: the install checks these same fields. */
export function signedMessage(f: SignedFields): Uint8Array {
  return new TextEncoder().encode([SIGNED_PREFIX, f.id, f.version, f.package, f.icon, f.author, f.summary].join("\n"));
}

export const ID = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*){2,5}$/;
export const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
export const HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const SUMMARY_MAX = 200;
export const TITLE_MAX = 40;
export const PACKAGE_MAX = 16 * 1024 * 1024;
export const ICON_MAX = 128 * 1024;
export const ICON_SIDE = 128;
/** App ids only the official key may publish. */
export const RESERVED_ID = /^dev\.pocket-nexus\./;
export const RESERVED_HANDLE = /^(pocket-?nexus|omarchy|official|admin|store)/;
/** The services an app from the store may ask for: they hold nobody's
 *  credentials and fetch no URL an app names. x, discord and homeassistant act
 *  as the device's owner; podcasts and youtube fetch for it, which would pass
 *  around the hosts it declares. */
export const OPEN_SERVICES = ["store", "glyphs", "maps", "images"] as const;

/** A version's order: 1.2.3 as one number. */
export function versionOrder(version: string): number | null {
  const m = VERSION.exec(version);
  return m ? Number(m[1]) * 100_000_000 + Number(m[2]) * 10_000 + Number(m[3]) : null;
}

export interface PackageFacts {
  id: string;
  title: string;
  version: string;
  services: string[];
  hosts: string[];
  /** The first variant's target id and profile hash (hex). */
  target: string;
  profile: string;
  applet: boolean;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Section kinds by name (PocketJS contracts/spec/pocket-package.ts POCKET_SECTION). */
export const SECTION_NAMES: Record<number, string> = { 1: "identity", 2: "plan", 3: "js", 4: "pak", 5: "cover", 7: "hostInputs", 8: "workerJs" };

export interface PackageVariant {
  target: string;
  hostAbi: number;
  /** SHA-256 of the build profile, hex */
  profile: string;
  /** FNV-1a64 of the sections' payloads, hex */
  hash: string;
  sections: { kind: number; name: string; bytes: number }[];
}

export interface PackageDescription {
  manifest: Record<string, unknown>;
  variants: PackageVariant[];
}

/** The bytes from the start of a package that hold its manifest and directory,
 *  or more than `head` holds. */
export const DIRECTORY_HEAD = 64 * 1024;

/** A `.pocket`'s manifest and directory (PocketJS contracts/spec/pocket-package.ts),
 *  read from its first bytes: the reason it cannot be read, or {more} when the
 *  directory runs past `head`. Offsets in the directory are absolute. */
export function describePackage(head: Uint8Array): PackageDescription | { more: number } | string {
  if (head.length < 32) return "the package is too short";
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== 0x544b4350) return "not a .pocket package";
  if (view.getUint32(4, true) !== 2) return "the package is not format version 2";
  const manifestSize = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const strings = view.getUint32(16, true);
  const stringsSize = view.getUint32(20, true);
  if (count < 1 || count > 64 || manifestSize > 1 << 20) return "the package's directory is out of range";
  const directory = 32 + Math.ceil(manifestSize / 16) * 16;
  const need = Math.ceil((strings + stringsSize) / 16) * 16;
  if (need > head.length) return { more: need };
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(head.subarray(32, 32 + manifestSize)));
  } catch {
    return "the package's manifest is not JSON";
  }
  const variants: PackageVariant[] = [];
  for (let i = 0; i < count; i++) {
    const at = directory + i * 64;
    const targetOffset = view.getUint32(at, true);
    const targetSize = view.getUint32(at + 4, true);
    const sections = view.getUint32(at + 12, true);
    const table = view.getUint32(at + 16, true);
    if (targetOffset + targetSize > need || sections > 64) return "the package's directory is out of range";
    if (table + sections * 16 > head.length) return { more: table + sections * 16 };
    variants.push({
      target: new TextDecoder().decode(head.subarray(targetOffset, targetOffset + targetSize)),
      hostAbi: view.getUint32(at + 8, true),
      profile: [...head.subarray(at + 32, at + 64)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      hash: view.getBigUint64(at + 24, true).toString(16).padStart(16, "0"),
      sections: Array.from({ length: sections }, (_, s) => {
        const kind = view.getUint32(table + s * 16, true);
        return { kind, name: SECTION_NAMES[kind] ?? `kind ${kind}`, bytes: view.getUint32(table + s * 16 + 12, true) };
      }),
    });
  }
  return { manifest, variants };
}

/** What a `.pocket` says about itself, or the reason it cannot be read. */
export function packageFacts(bytes: Uint8Array): PackageFacts | string {
  if (bytes.length < 32 + 64 + 8) return "the package is too short";
  const described = describePackage(bytes);
  if (typeof described === "string") return described;
  if ("more" in described) return "the package's directory is out of range";
  const manifest = described.manifest as { id?: unknown; title?: unknown; version?: unknown; applet?: { services?: unknown; hosts?: unknown } };
  const first = described.variants[0]!;
  return {
    id: typeof manifest.id === "string" ? manifest.id : "",
    title: typeof manifest.title === "string" ? manifest.title : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    services: strings(manifest.applet?.services),
    hosts: strings(manifest.applet?.hosts),
    target: first.target,
    profile: first.profile,
    applet: manifest.applet !== undefined,
  };
}

/** SHA-256 hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromBase64url(text: string): Uint8Array {
  const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Whether `key` signed `fields`. */
export async function signatureValid(key: string, signature: string, fields: SignedFields): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("raw", fromBase64url(key), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, fromBase64url(signature), signedMessage(fields));
  } catch {
    return false;
  }
}
