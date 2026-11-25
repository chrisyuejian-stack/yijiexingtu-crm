ALTER TABLE platform_admins ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','consultant'));
ALTER TABLE partner_courses ADD COLUMN format TEXT NOT NULL DEFAULT 'course' CHECK(format IN ('course','lecture'));
ALTER TABLE partner_courses ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0 CHECK(is_free IN (0,1));
ALTER TABLE course_applications ADD COLUMN paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1));
ALTER TABLE course_applications ADD COLUMN paid_by TEXT REFERENCES platform_admins(id);
ALTER TABLE course_applications ADD COLUMN paid_at INTEGER;
ALTER TABLE tenant_promo_assets ADD COLUMN qr_caption TEXT NOT NULL DEFAULT '' CHECK(length(qr_caption)<=12);
CREATE TABLE promo_followups(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX promo_followups_timeline ON promo_followups(campaign_id,tenant_id,created_at DESC,id);
CREATE TABLE promo_user_notices(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  dismissed_at INTEGER,
  deadline_shown_at INTEGER,
  PRIMARY KEY(tenant_id,user_id,campaign_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
