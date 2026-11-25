-- 两新列存在，业务行数不变，quick_check=ok，foreign_key_check无结果。
PRAGMA table_info('gallery_images');
PRAGMA table_info('tenants');
SELECT 'tenants' entity,COUNT(*) n FROM tenants UNION ALL SELECT 'gallery_images',COUNT(*) FROM gallery_images UNION ALL SELECT 'plans',COUNT(*) FROM plans UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons;
SELECT COUNT(*) invalid_limit FROM tenants WHERE gallery_storage_limit<0;
SELECT COUNT(*) invalid_bytes FROM gallery_images WHERE bytes<0;
PRAGMA quick_check;
PRAGMA foreign_key_check;
