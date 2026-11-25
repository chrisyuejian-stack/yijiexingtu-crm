CREATE TRIGGER credit_income_consume AFTER INSERT ON package_transactions
WHEN NEW.type='consume' AND NEW.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
BEGIN
  INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,created_at,created_by,updated_at,updated_by,version)
  SELECT NEW.tenant_id,NEW.id,NEW.date,
    CASE WHEN p.unit_price IS NULL THEN 0 ELSE (CAST(ROUND(-NEW.delta*100) AS INTEGER)*p.unit_price+50)/100 END,
    CASE WHEN p.unit_price IS NULL THEN -NEW.delta ELSE 0 END,
    CASE WHEN p.unit_price IS NULL THEN 'unpriced' WHEN NEW.note='补扣欠课时' THEN 'debt_repayment' ELSE 'checkout' END,
    NEW.created_at,NEW.created_by,NEW.updated_at,NEW.updated_by,1
  FROM packages p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id;
END;
