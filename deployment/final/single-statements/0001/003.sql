CREATE TABLE tenant_slug_aliases (slug TEXT PRIMARY KEY COLLATE NOCASE,tenant_id TEXT NOT NULL REFERENCES tenants(id),expires_at INTEGER NOT NULL);
