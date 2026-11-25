ALTER TABLE settlements ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(total_amount)='integer');
