CREATE TABLE promo_user_notices(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  dismissed_at INTEGER,
  deadline_shown_at INTEGER,
  PRIMARY KEY(tenant_id,user_id,campaign_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
