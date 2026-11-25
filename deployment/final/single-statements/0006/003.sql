ALTER TABLE lessons ADD COLUMN override_rate INTEGER CHECK(override_rate IS NULL OR (typeof(override_rate)='integer' AND override_rate>=0));
