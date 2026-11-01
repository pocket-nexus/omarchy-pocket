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

/** What a `.pocket` says about itself (PocketJS contracts/spec/pocket-package.ts),
 *  or the reason it cannot be read. */
export function packageFacts(bytes: Uint8Array): PackageFacts | string {
  if (bytes.length < 32 + 64 + 8) return "the package is too short";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x544b4350) return "not a .pocket package";
  if (view.getUint32(4, true) !== 2) return "the package is not format version 2";
  const manifestSize = view.getUint32(8, true);
  const variants = view.getUint32(12, true);
  if (variants < 1 || manifestSize > 1 << 20 || 32 + manifestSize + 64 > bytes.length) return "the package's directory is out of range";
  let manifest: { id?: unknown; title?: unknown; version?: unknown; applet?: { services?: unknown; hosts?: unknown } };
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(32, 32 + manifestSize)));
  } catch {
    return "the package's manifest is not JSON";
  }
  const at = 32 + Math.ceil(manifestSize / 16) * 16;
  if (at + 64 > bytes.length) return "the package's directory is out of range";
  const targetOffset = view.getUint32(at, true);
  const targetSize = view.getUint32(at + 4, true);
  const tableOffset = view.getUint32(16, true);
  if (tableOffset + targetOffset + targetSize > bytes.length) return "the package's target is out of range";
  const target = new TextDecoder().decode(bytes.subarray(tableOffset + targetOffset, tableOffset + targetOffset + targetSize));
  const profile = [...bytes.subarray(at + 32, at + 64)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    id: typeof manifest.id === "string" ? manifest.id : "",
    title: typeof manifest.title === "string" ? manifest.title : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    services: strings(manifest.applet?.services),
    hosts: strings(manifest.applet?.hosts),
    target,
    profile,
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
