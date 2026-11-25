CREATE TRIGGER promo_image_pending_limit BEFORE INSERT ON promo_images
WHEN NEW.tenant_id<>'platform' AND NEW.ready=0 AND (SELECT COUNT(*) FROM promo_images WHERE tenant_id=NEW.tenant_id AND ready=0)>=5
BEGIN SELECT RAISE(ABORT,'promo_pending_limit'); END;
