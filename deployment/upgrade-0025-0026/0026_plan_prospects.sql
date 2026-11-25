-- 仅新增表。旧 plans 的 CHECK 保留；纯意向的内部 source_lead_id 为 prospect:<plan_id>。
-- 外部 API / 文档 / 修订始终将此标识映射为空，不产生虚假线索。
CREATE TABLE plan_prospects (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 id TEXT NOT NULL,
 data_enc TEXT NOT NULL,
 phone_last4 TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 created_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,id) REFERENCES plans(tenant_id,id)
);
