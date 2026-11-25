ALTER TABLE settlements ADD COLUMN cost_amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cost_amount)='integer');
