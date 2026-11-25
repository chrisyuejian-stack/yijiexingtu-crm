CREATE TABLE guardian_links (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,parent_user_id TEXT NOT NULL,student_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('mother','father','grandparent','other')),
 created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,revoked_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,parent_user_id) REFERENCES users(tenant_id,id),
 FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id)
);
