-- Immutable per-record staging snapshot: one atomic D1 batch captures the database; Cron encrypts bounded pages.
CREATE TABLE backup_snapshots(id TEXT PRIMARY KEY,at INTEGER NOT NULL,status TEXT NOT NULL,manifest_json TEXT NOT NULL);
