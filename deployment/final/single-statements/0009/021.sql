CREATE TABLE trusted_imports(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,PRIMARY KEY(tenant_id,id));
