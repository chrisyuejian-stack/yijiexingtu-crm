CREATE TABLE tenant_modules(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,PRIMARY KEY(tenant_id,id));
