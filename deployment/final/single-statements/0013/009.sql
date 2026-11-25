CREATE INDEX promo_followups_timeline ON promo_followups(campaign_id,tenant_id,created_at DESC,id);
