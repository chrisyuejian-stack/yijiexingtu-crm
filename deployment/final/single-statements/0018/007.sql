INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,reversed_by,created_at,created_by,updated_at,updated_by,version,deleted_at)
SELECT e.* FROM credit_income_legacy_estimates e;
