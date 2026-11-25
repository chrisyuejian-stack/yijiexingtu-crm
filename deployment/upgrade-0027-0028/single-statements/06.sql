CREATE TABLE plan_v2_conversions(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,source_revision_id TEXT NOT NULL,source_doc_sha256 TEXT NOT NULL,
 mapping_version INTEGER NOT NULL DEFAULT 1,v2_initial_projection_sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,plan_id,source_revision_id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),
 FOREIGN KEY(tenant_id,source_revision_id) REFERENCES plan_revisions(tenant_id,id));
