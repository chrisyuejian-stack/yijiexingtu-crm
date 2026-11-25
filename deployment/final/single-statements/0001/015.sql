CREATE TABLE auth_log (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,user_id TEXT,phone_last4 TEXT,event TEXT NOT NULL,ip TEXT NOT NULL,ua TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
