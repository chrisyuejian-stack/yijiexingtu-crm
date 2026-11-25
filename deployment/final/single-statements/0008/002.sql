CREATE TABLE lesson_submissions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,lesson_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('attendance','comments')),status TEXT NOT NULL CHECK(status IN ('pending','returned','confirmed','superseded')),
 public_text TEXT NOT NULL DEFAULT '',homework TEXT NOT NULL DEFAULT '',base_fingerprint TEXT NOT NULL,comment_fingerprint TEXT NOT NULL,
 submitted_by TEXT NOT NULL,submitted_at INTEGER NOT NULL,reviewed_by TEXT,reviewed_at INTEGER,reason TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,lesson_id) REFERENCES lessons(tenant_id,id));
