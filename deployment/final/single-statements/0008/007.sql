CREATE TABLE lesson_comments (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,lesson_id TEXT NOT NULL,student_id TEXT,
 text TEXT NOT NULL DEFAULT '',homework TEXT NOT NULL DEFAULT '',published_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,lesson_id) REFERENCES lessons(tenant_id,id),FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id));
