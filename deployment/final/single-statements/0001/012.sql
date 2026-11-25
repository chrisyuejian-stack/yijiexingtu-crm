CREATE TABLE sessions (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,token_hash TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,idle_ms INTEGER,
 ip TEXT NOT NULL,ua TEXT NOT NULL,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,token_hash),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
