CREATE TABLE tenant_branding (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL DEFAULT 'brand', display_name TEXT NOT NULL, logo TEXT, login_bg TEXT,
 theme_color TEXT NOT NULL DEFAULT '#2B4C7E',welcome_text TEXT NOT NULL DEFAULT '',consultant_qr TEXT,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id)
);
