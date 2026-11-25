-- 只读异常明细，含机构/记录ID；人工确认原始业务凭据，不能自动改写。
SELECT tenant_id,id,student_id,package_id,amount,paid_at FROM student_payments WHERE amount<0 OR ABS(amount*100-ROUND(amount*100))>0.0000001 ORDER BY tenant_id,id;
SELECT tenant_id,id,student_id,unit_price,amount FROM packages WHERE unit_price<0 OR amount<0 OR ABS(unit_price*100-ROUND(unit_price*100))>0.0000001 OR ABS(amount*100-ROUND(amount*100))>0.0000001 ORDER BY tenant_id,id;
