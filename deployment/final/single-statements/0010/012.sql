CREATE TABLE partner_write_guards(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,PRIMARY KEY(tenant_id,id));
