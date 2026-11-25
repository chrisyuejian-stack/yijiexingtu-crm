CREATE TABLE tenant_purge_jobs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  id TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  phase INTEGER NOT NULL DEFAULT -1,
  counts TEXT NOT NULL DEFAULT '{}'
);
