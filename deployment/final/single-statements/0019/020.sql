CREATE TABLE tenant_ai_overrides (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL DEFAULT 'limits',fast_daily_limit INTEGER,deep_daily_limit INTEGER,
 PRIMARY KEY(tenant_id,id),CHECK(fast_daily_limit IS NULL OR fast_daily_limit>=0),CHECK(deep_daily_limit IS NULL OR deep_daily_limit>=0)
);
