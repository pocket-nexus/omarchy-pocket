// SPDX-License-Identifier: GPL-3.0-or-later
// applets/store/api.ts — the `appstore` service of omarchy-pocketd
// (daemon/appstore.ts): the catalog, icons, installs. An icon arrives as an
// IMG entry and becomes a texture here.

import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { companionService, fetch } from "../lib/net.ts";

export interface StoreApp {
  id: string;
  version: string;
  title: string;
  summary: string;
  author: string;
  official: boolean;
  services: string[];
  hosts: string[];
  icon: string;
  bytes: number;
  /** The version on this device, null when it has none. */
  installed: string | null;
  /** It came with the system: it updates, and it cannot be removed. */
  system: boolean;
}

export interface StoreClient {
  catalog(fresh?: boolean): Promise<StoreApp[]>;
  install(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  open(id: string): Promise<void>;
  /** The icon's texture, or -1 until it arrives; `icons()` changes when one does. */
  icon(sha: string): number;
  icons: () => number;
}

const call = async <T>(path: string, timeoutMs = 60_000): Promise<T> => {
  const response = await fetch(companionService("appstore", path), { timeoutMs, maxBytes: 512 * 1024 });
  const body = JSON.parse(await response.text()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `the store answered ${response.status}`);
  return body;
};

export function createStoreClient(): StoreClient {
  const textures = new Map<string, number>();
  const asked = new Set<string>();
  const [icons, setIcons] = createSignal(0);
  return {
    catalog: async (fresh = false) => (await call<{ apps: StoreApp[] }>(`/catalog${fresh ? "?fresh=1" : ""}`)).apps,
    install: async (id) => void (await call(`/install?id=${encodeURIComponent(id)}`, 120_000)),
    remove: async (id) => void (await call(`/remove?id=${encodeURIComponent(id)}`)),
    open: async (id) => void (await call(`/open?id=${encodeURIComponent(id)}`)),
    icon(sha) {
      const have = textures.get(sha);
      if (have !== undefined) return have;
      if (!asked.has(sha)) {
        asked.add(sha);
        fetch(companionService("appstore", `/icon?sha=${sha}`), { timeoutMs: 30_000, maxBytes: 64 * 1024 }).then(
          async (response) => {
            if (!response.ok) return;
            const handle = getOps().uploadImgEntry?.(await response.bytes()) ?? -1;
            if (handle < 0) return;
            textures.set(sha, handle);
            setIcons(icons() + 1);
          },
          () => asked.delete(sha),
        );
      }
      return -1;
    },
    icons,
  };
}

export const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** What an app's button offers. */
export type Action = "get" | "update" | "open" | "busy";
export function actionOf(app: StoreApp, busy: boolean): Action {
  if (busy) return "busy";
  if (app.installed === null) return "get";
  return app.installed === app.version ? "open" : "update";
}
