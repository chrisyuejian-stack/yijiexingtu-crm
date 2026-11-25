-- 只读：应有4学科，每个0.1为published，4种文档默认风格；版本数可以因后续正常运营增加。
SELECT key,name,current_published_version FROM subject_packs ORDER BY key;
SELECT key,pack_version,version,status FROM subject_pack_versions ORDER BY key,pack_version;
SELECT doc_type,pack_id FROM style_defaults ORDER BY doc_type;
SELECT COUNT(*) pending_guard_rows FROM platform_ops_guards;
