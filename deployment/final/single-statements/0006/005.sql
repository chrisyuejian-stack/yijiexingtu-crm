ALTER TABLE lessons ADD COLUMN locked_rate INTEGER CHECK(locked_rate IS NULL OR typeof(locked_rate)='integer');
