CREATE TABLE audit_log (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,actor_id TEXT NOT NULL,actor_label TEXT NOT NULL,module TEXT NOT NULL,action TEXT NOT NULL,
 entity_id TEXT,summary TEXT NOT NULL,before_json TEXT,after_json TEXT,PRIMARY KEY(tenant_id,id)
);
