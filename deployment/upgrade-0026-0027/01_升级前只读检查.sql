-- 只读，确认完整0026。新列不存在才执行对应ADD COLUMN。
PRAGMA table_info('gallery_images');
PRAGMA table_info('tenants');
SELECT 'tenants' entity,COUNT(*) n FROM tenants UNION ALL SELECT 'gallery_images',COUNT(*) FROM gallery_images UNION ALL SELECT 'plans',COUNT(*) FROM plans UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons;
