-- 只读结构判别：适用于本项目原版 0004/0005；不能证明金额未被人工篡改或重复迁移。
WITH p AS (
 SELECT SUM(name IN ('unit_price','amount') AND UPPER(type)='REAL') real_columns,
 SUM(name IN ('unit_price','amount') AND UPPER(type)='INTEGER') integer_columns,
 SUM(name IN ('unit_price_cents','amount_cents')) temporary_columns FROM pragma_table_info('packages')
), q AS (
 SELECT SUM(name='amount' AND UPPER(type)='REAL') real_columns,
 SUM(name='amount' AND UPPER(type)='INTEGER') integer_columns,
 SUM(name='amount_cents') temporary_columns FROM pragma_table_info('student_payments')
), a AS (SELECT COUNT(*) n FROM pragma_table_info('audit_log') WHERE name='money_version'),
 t AS (SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN ('ledger_student_reference','payment_student_reference','payment_student_update','package_owner_immutable'))
SELECT CASE
 WHEN p.real_columns=2 AND q.real_columns=1 AND p.temporary_columns=0 AND q.temporary_columns=0 AND a.n=0 AND t.n=0 THEN '未迁移'
 WHEN p.integer_columns=2 AND q.integer_columns=1 AND p.temporary_columns=0 AND q.temporary_columns=0 AND a.n=1 AND t.n=4 THEN '已迁移'
 ELSE '半迁移或未知结构：停止操作，从升级前备份恢复并核查'
 END migration_state FROM p,q,a,t;
