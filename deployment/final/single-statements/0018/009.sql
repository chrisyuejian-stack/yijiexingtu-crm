CREATE TRIGGER credit_income_reverse AFTER INSERT ON package_transactions
WHEN NEW.type='reversal' AND NEW.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
BEGIN
  UPDATE credit_income_entries SET reversed_by=NEW.id,updated_at=NEW.updated_at,updated_by=NEW.updated_by,version=version+1
  WHERE tenant_id=NEW.tenant_id AND reversed_by IS NULL AND deleted_at IS NULL AND id IN (
    SELECT x.id FROM package_transactions x WHERE x.tenant_id=NEW.tenant_id AND x.participant_id=NEW.participant_id
      AND x.package_id=NEW.package_id AND x.deleted_at IS NULL AND x.id<>NEW.id
  );
  INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,reversed_by,created_at,created_by,updated_at,updated_by,version)
  SELECT NEW.tenant_id,NEW.id,NEW.date,-COALESCE(SUM(e.amount),0),ROUND(-COALESCE(SUM(e.unpriced_units),0),2),
    'reversal',NEW.id,NEW.created_at,NEW.created_by,NEW.updated_at,NEW.updated_by,1
  FROM credit_income_entries e WHERE e.tenant_id=NEW.tenant_id AND e.reversed_by=NEW.id AND e.deleted_at IS NULL;
END;
