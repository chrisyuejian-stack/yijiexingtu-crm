CREATE TABLE tenant_data_versions(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),version INTEGER NOT NULL DEFAULT 0);
