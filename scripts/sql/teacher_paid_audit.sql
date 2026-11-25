-- 只读，支持已完成 0004 及以后的库。列出 teacher_paid 与当前有效规则不一致的课次。
-- locked=1 的行必须先核对批准快照，不能直接 UPDATE 或静默改写。
WITH checked AS (
 SELECT l.tenant_id,l.id,l.start_at,l.status,l.teacher_paid,
 COALESCE(m.locked,0) locked,
 CASE WHEN l.status='completed' THEN 1
 WHEN l.status IN ('student_leave','student_no_show','teacher_leave','cancelled') THEN
   CASE json_type(s.value,'$.'||l.status||'.teacherPaid') WHEN 'true' THEN 1 WHEN 'false' THEN 0
   ELSE CASE WHEN l.status='student_no_show' THEN 1 ELSE 0 END END
 ELSE 0 END expected_teacher_paid,
 CASE WHEN s.id IS NULL THEN '从未保存' ELSE '已保存（缺失字段逐项回落）' END policy_source
 FROM lessons l LEFT JOIN tenant_settings s ON s.tenant_id=l.tenant_id AND s.id='absence_policies'
 LEFT JOIN settlements m ON m.tenant_id=l.tenant_id AND m.month=SUBSTR(l.start_at,1,7) AND m.deleted_at IS NULL
 WHERE l.deleted_at IS NULL
)
SELECT * FROM checked WHERE teacher_paid<>expected_teacher_paid ORDER BY tenant_id,start_at,id;
