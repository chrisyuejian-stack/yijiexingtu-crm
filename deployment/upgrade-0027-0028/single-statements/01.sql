-- v0.5：只新增方案附属表，不改 plans 与既有迁移。
CREATE TABLE plan_templates(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 applicability_json TEXT NOT NULL CHECK(json_valid(applicability_json)),doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),
 source_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_json)),version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id));
