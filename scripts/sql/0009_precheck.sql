-- 只读：三个计数必须全为0；foreign_key_check必须无结果。任何异常均人工核对，不自动改写。
SELECT COUNT(*) invalid_money FROM packages WHERE (unit_price IS NOT NULL AND (typeof(unit_price)<>'integer' OR unit_price<0)) OR (amount IS NOT NULL AND (typeof(amount)<>'integer' OR amount<0));
SELECT COUNT(*) invalid_profile_links FROM users u WHERE u.deleted_at IS NULL AND ((u.teacher_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM teachers p WHERE p.tenant_id=u.tenant_id AND p.id=u.teacher_id AND p.deleted_at IS NULL)) OR (u.student_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM students p WHERE p.tenant_id=u.tenant_id AND p.id=u.student_id AND p.deleted_at IS NULL)));
SELECT COUNT(*) existing_stage6_objects FROM sqlite_master WHERE name IN ('classes','class_members','followup_notes','followup_tasks','student_routines','leads','referrals','announcement_reads','platform_announcements','announcement_targets','maintenance_leases','data_jobs','data_job_rows','trusted_imports','backup_runs','backup_snapshots','backup_snapshot_rows');
PRAGMA foreign_key_check;
-- 人工核对：以下表尚无 contact_text / class_id。已有任一新增字段即停止，不能重跑迁移。
PRAGMA table_info(tenant_branding);
PRAGMA table_info(lessons);
PRAGMA table_info(schedule_templates);
