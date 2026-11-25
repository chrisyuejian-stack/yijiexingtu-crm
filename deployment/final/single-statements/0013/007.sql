ALTER TABLE tenant_promo_assets ADD COLUMN qr_caption TEXT NOT NULL DEFAULT '' CHECK(length(qr_caption)<=12);
