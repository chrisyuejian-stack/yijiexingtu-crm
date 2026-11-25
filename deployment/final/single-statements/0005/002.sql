ALTER TABLE packages ADD COLUMN amount_cents INTEGER CHECK(amount_cents IS NULL OR (typeof(amount_cents)='integer' AND amount_cents>=0));
