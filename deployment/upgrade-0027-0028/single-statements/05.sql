CREATE TABLE plan_briefs(
 tenant_id TEXT NOT NULL,plan_id TEXT NOT NULL,text_enc TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,PRIMARY KEY(tenant_id,plan_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
