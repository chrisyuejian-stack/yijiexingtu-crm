CREATE UNIQUE INDEX one_data_job ON data_jobs(tenant_id) WHERE status IN ('staging','ready');
