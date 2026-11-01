// SPDX-License-Identifier: GPL-3.0-or-later
// applets/store/model.ts — the catalog and what is being installed. It outlives
// a remount (a resize), so an install goes on while the window changes.

import { createSignal, type Accessor } from "solid-js";
import type { StoreApp, StoreClient } from "./api.ts";

export interface StoreModel {
  status: Accessor<"loading" | "ready" | "error">;
  error: Accessor<string>;
  apps: Accessor<StoreApp[]>;
  app(id: string): StoreApp | null;
  reload(): void;
  busy(id: string): boolean;
  /** The last thing that went wrong with `id`, "" when nothing did. */
  failure(id: string): string;
  install(app: StoreApp): void;
  remove(app: StoreApp): void;
  open(app: StoreApp): void;
}

export function createStoreModel(client: StoreClient): StoreModel {
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [error, setError] = createSignal("");
  const [apps, setApps] = createSignal<StoreApp[]>([]);
  const [working, setWorking] = createSignal<Record<string, boolean>>({});
  const [failures, setFailures] = createSignal<Record<string, string>>({});
  const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

  const reload = (fresh = true) => {
    if (apps().length === 0) setStatus("loading");
    client.catalog(fresh).then(
      (list) => {
        setApps(list);
        setStatus("ready");
      },
      (failure: unknown) => {
        setError(message(failure));
        if (apps().length === 0) setStatus("error");
      },
    );
  };
  const work = (app: StoreApp, job: Promise<void>) => {
    setWorking((now) => ({ ...now, [app.id]: true }));
    setFailures(({ [app.id]: _, ...rest }) => rest);
    job.then(
      () => {
        setWorking(({ [app.id]: _, ...rest }) => rest);
        reload(false);
      },
      (failure: unknown) => {
        setWorking(({ [app.id]: _, ...rest }) => rest);
        setFailures((now) => ({ ...now, [app.id]: message(failure) }));
      },
    );
  };
  reload();
  return {
    status,
    error,
    apps,
    app: (id) => apps().find((app) => app.id === id) ?? null,
    reload: () => reload(true),
    busy: (id) => working()[id] === true,
    failure: (id) => failures()[id] ?? "",
    install: (app) => work(app, client.install(app.id)),
    remove: (app) => work(app, client.remove(app.id)),
    open: (app) => work(app, client.open(app.id)),
  };
}
