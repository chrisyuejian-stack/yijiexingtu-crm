-- 第八阶段收尾：机构配额由数据库原子兜底；平台素材不受机构配额约束。
CREATE INDEX promo_image_cleanup ON promo_images(ready,created_at);
