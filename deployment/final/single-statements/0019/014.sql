CREATE TABLE login_choices (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL,user_version INTEGER NOT NULL,tenant_version INTEGER NOT NULL,
 group_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
