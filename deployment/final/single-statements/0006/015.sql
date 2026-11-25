ALTER TABLE settlements ADD COLUMN tuition_amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(tuition_amount)='integer');
