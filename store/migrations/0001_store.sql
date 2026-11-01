-- A publisher is an ed25519 key; its handle is first come, first served.
CREATE TABLE publishers (
  key TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL
);
-- An app id belongs to the key that published it first.
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL REFERENCES publishers(key),
  created INTEGER NOT NULL
);
-- state: pending (waits for an editor), listed, rejected, removed.
CREATE TABLE versions (
  id TEXT NOT NULL REFERENCES apps(id),
  version TEXT NOT NULL,
  sort INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  author TEXT NOT NULL,
  key TEXT NOT NULL,
  services TEXT NOT NULL,
  hosts TEXT NOT NULL,
  profile TEXT NOT NULL,
  target TEXT NOT NULL,
  package TEXT NOT NULL,
  icon TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  signature TEXT NOT NULL,
  state TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX versions_state ON versions(state, profile);
CREATE TABLE publish_counts (
  day INTEGER NOT NULL,
  address TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, address)
);
