CREATE TRIGGER purged_promo_image_insert_guard BEFORE INSERT ON promo_images
WHEN NEW.tenant_id GLOB 'ten_*' AND (
  NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
  OR EXISTS(SELECT 1 FROM tenant_purge_jobs WHERE tenant_id=NEW.tenant_id)
)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
