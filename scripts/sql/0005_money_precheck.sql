-- 仅在结构检查为“未迁移”后执行。两个结果全部为 0 才允许执行 0005。
SELECT COUNT(*) FROM student_payments WHERE amount<0 OR ABS(amount*100-ROUND(amount*100))>0.0000001;
SELECT COUNT(*) FROM packages WHERE unit_price<0 OR amount<0 OR ABS(unit_price*100-ROUND(unit_price*100))>0.0000001 OR ABS(amount*100-ROUND(amount*100))>0.0000001;
