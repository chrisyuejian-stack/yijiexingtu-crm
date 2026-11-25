CREATE TABLE users (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL,phone_hmac TEXT NOT NULL,phone_enc TEXT NOT NULL,phone_last4 TEXT NOT NULL,name TEXT NOT NULL,
 roles TEXT NOT NULL,teacher_id TEXT,student_id TEXT,salt TEXT NOT NULL,digest TEXT NOT NULL,iterations INTEGER NOT NULL DEFAULT 100000,
 must_change INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,phone_hmac)
);
