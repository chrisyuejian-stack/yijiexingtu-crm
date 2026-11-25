CREATE TABLE plan_sample_templates(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),pack_key TEXT NOT NULL,pack_version TEXT NOT NULL,sample_key TEXT NOT NULL,
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,pack_key,pack_version,sample_key));
