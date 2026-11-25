-- 艺界星途阶段4：课程方案；0001–0020保持原样。
CREATE TABLE plans(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,student_id TEXT,source_lead_id TEXT,subject TEXT NOT NULL,title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','sent','signed','archived')),
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),context_id TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 current_revision_id TEXT,sent_revision_id TEXT,signed_revision_id TEXT,signed_at INTEGER,archived_at INTEGER,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),CHECK(student_id IS NOT NULL OR source_lead_id IS NOT NULL));
