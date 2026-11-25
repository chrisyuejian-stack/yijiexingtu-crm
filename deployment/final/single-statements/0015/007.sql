CREATE TABLE tenant_export_runs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  id TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  tenant_version INTEGER NOT NULL,
  data_version INTEGER NOT NULL,
  table_index INTEGER NOT NULL DEFAULT 0,
  next_offset INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER
);
