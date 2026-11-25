CREATE VIEW credit_income_legacy_estimates AS
SELECT x.tenant_id,x.id,x.date AS booked_on,
  CASE WHEN s.billing_mode='overall' OR p.unit_price IS NULL THEN 0
    ELSE CASE WHEN x.delta>0 THEN -1 ELSE 1 END *
      ((CAST(ROUND(ABS(x.delta)*100) AS INTEGER)*p.unit_price+50)/100) END AS amount,
  CASE WHEN s.billing_mode<>'overall' AND p.unit_price IS NULL THEN -x.delta ELSE 0 END AS unpriced_units,
  CASE WHEN s.billing_mode='overall' THEN 'legacy_overall'
    WHEN p.unit_price IS NULL THEN 'legacy_no_price' ELSE 'legacy_estimate' END AS source,
  NULL AS reversed_by,x.created_at,x.created_by,x.updated_at,x.updated_by,1 AS version,NULL AS deleted_at
FROM package_transactions x
JOIN packages p ON p.tenant_id=x.tenant_id AND p.id=x.package_id
JOIN students s ON s.tenant_id=x.tenant_id AND s.id=x.student_id
WHERE x.deleted_at IS NULL AND x.type IN ('consume','reversal');
