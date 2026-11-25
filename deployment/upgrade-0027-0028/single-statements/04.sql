CREATE TABLE plan_reference_flags(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision_id TEXT,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,plan_id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),
 FOREIGN KEY(tenant_id,revision_id) REFERENCES plan_revisions(tenant_id,id));
