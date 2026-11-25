CREATE TABLE style_pack_scopes(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,pack_id TEXT NOT NULL REFERENCES style_packs(id),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,pack_id));
