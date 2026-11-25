CREATE TABLE share_links(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,revision_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,revoked_at INTEGER,visits INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),FOREIGN KEY(tenant_id,revision_id) REFERENCES plan_revisions(tenant_id,id));
