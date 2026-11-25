ALTER TABLE settlements ADD COLUMN profit_amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(profit_amount)='integer');
