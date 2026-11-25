CREATE TABLE plan_v2_elements(
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,plan_id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
