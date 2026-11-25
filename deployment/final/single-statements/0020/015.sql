CREATE TABLE tenant_brand(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,qr_image_id TEXT,PRIMARY KEY(tenant_id,id));
