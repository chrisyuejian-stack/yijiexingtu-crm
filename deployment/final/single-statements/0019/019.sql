CREATE TABLE tenant_subjects (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,pack_version TEXT NOT NULL DEFAULT '0.1',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(tenant_id,id)
);
