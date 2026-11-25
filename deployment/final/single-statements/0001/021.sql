CREATE TABLE platform_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,admin_id TEXT NOT NULL,action TEXT NOT NULL,tenant_id TEXT,target TEXT,detail TEXT NOT NULL,reason TEXT,ip TEXT NOT NULL);
