UPDATE student_payments SET amount_cents=CAST(ROUND(amount*100) AS INTEGER);
