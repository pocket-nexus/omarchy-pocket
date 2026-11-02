-- A version's sample data (applets/lib/mock.ts) for the website's player: the
-- SHA-256 of the packed document in R2 under mock/<sha>, '' when it has none.
ALTER TABLE versions ADD COLUMN mock TEXT NOT NULL DEFAULT '';
