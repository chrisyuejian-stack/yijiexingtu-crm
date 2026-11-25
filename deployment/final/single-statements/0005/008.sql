ALTER TABLE student_payments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(amount_cents)='integer' AND amount_cents>=0);
