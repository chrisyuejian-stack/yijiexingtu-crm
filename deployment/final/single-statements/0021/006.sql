CREATE TABLE plan_revisions(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,seq INTEGER NOT NULL,student_id TEXT,source_lead_id TEXT,
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),context_id TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),image_ids_json TEXT NOT NULL CHECK(json_valid(image_ids_json)),
 action TEXT NOT NULL,sent_at INTEGER,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,plan_id,seq),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),FOREIGN KEY(tenant_id,context_id) REFERENCES plan_contexts(tenant_id,id));
