-- v0.5：只新增方案附属表，不改 plans 与既有迁移。
CREATE TABLE plan_templates(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 applicability_json TEXT NOT NULL CHECK(json_valid(applicability_json)),doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),
 source_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_json)),version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id));
CREATE INDEX plan_templates_list ON plan_templates(tenant_id,deleted_at,updated_at,id);
CREATE TABLE plan_sample_templates(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),pack_key TEXT NOT NULL,pack_version TEXT NOT NULL,sample_key TEXT NOT NULL,
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,pack_key,pack_version,sample_key));
CREATE TABLE plan_reference_flags(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision_id TEXT,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,plan_id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),
 FOREIGN KEY(tenant_id,revision_id) REFERENCES plan_revisions(tenant_id,id));
CREATE TABLE plan_briefs(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,text_enc TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,PRIMARY KEY(tenant_id,plan_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
CREATE TABLE plan_v2_conversions(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,source_revision_id TEXT NOT NULL,source_doc_sha256 TEXT NOT NULL,
 mapping_version INTEGER NOT NULL DEFAULT 1,v2_initial_projection_sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,plan_id,source_revision_id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),
 FOREIGN KEY(tenant_id,source_revision_id) REFERENCES plan_revisions(tenant_id,id));
CREATE TABLE plan_v2_elements(
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,plan_id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
CREATE INDEX plan_v2_elements_owner ON plan_v2_elements(tenant_id,plan_id,kind);
CREATE TRIGGER plan_v2_element_identity BEFORE UPDATE ON plan_v2_elements BEGIN SELECT RAISE(ABORT,'plan_v2_element_immutable'); END;
CREATE TRIGGER plan_v2_conversion_identity BEFORE UPDATE ON plan_v2_conversions BEGIN SELECT RAISE(ABORT,'plan_v2_conversion_immutable'); END;
