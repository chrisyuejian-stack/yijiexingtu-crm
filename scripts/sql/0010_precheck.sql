-- 以下计数全部为0、foreign_key_check无结果才可继续。异常先列明细人工核查；失败从备份恢复，不重跑半迁移。
SELECT COUNT(*) existing_stage8_tables FROM sqlite_master WHERE type='table' AND name IN('campaigns','campaign_targets','campaign_reads','promo_images','poster_templates','poster_outputs','tenant_promo_assets','partner_courses','partner_sessions','course_applications','partner_rosters','partner_write_guards');
SELECT COUNT(*) existing_stage8_columns FROM pragma_table_info('lessons') WHERE name IN('source_course_id','source_session_id');
PRAGMA foreign_key_check;
