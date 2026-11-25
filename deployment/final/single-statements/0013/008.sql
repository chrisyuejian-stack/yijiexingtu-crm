CREATE TABLE promo_followups(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
