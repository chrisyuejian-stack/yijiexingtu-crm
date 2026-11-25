CREATE TRIGGER promo_image_ready_insert_limit BEFORE INSERT ON promo_images
WHEN NEW.tenant_id<>'platform' AND NEW.ready=1
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM promo_images WHERE tenant_id=NEW.tenant_id AND ready=1)>=50 THEN RAISE(ABORT,'promo_count_limit') END;
 SELECT CASE WHEN NEW.bytes+(SELECT COALESCE(SUM(bytes),0) FROM promo_images WHERE tenant_id=NEW.tenant_id AND ready=1)>104857600 THEN RAISE(ABORT,'promo_bytes_limit') END;
END;
