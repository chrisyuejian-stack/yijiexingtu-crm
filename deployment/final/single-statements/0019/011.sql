CREATE TABLE platform_phone_index (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL,phone_hmac_platform TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
