CREATE TRIGGER credit_income_price_completion AFTER UPDATE OF unit_price ON packages
WHEN OLD.unit_price IS NULL AND NEW.unit_price IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
 AND EXISTS(
   SELECT 1 FROM credit_income_entries e JOIN package_transactions x ON x.tenant_id=e.tenant_id AND x.id=e.id
   WHERE e.tenant_id=NEW.tenant_id AND x.package_id=NEW.id AND e.reversed_by IS NULL AND e.unpriced_units<>0 AND e.deleted_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT,'credit_price_locked') WHERE EXISTS(
    SELECT 1 FROM settlements WHERE tenant_id=NEW.tenant_id AND month=substr(date(NEW.updated_at/1000,'unixepoch','+8 hours'),1,7)
      AND locked=1 AND deleted_at IS NULL
  );
  UPDATE credit_income_entries
    SET amount=CASE WHEN unpriced_units<0 THEN -1 ELSE 1 END *
      ((CAST(ROUND(ABS(unpriced_units)*100) AS INTEGER)*NEW.unit_price+50)/100),
      unpriced_units=0,booked_on=date(NEW.updated_at/1000,'unixepoch','+8 hours'),source='price_completion',
      updated_at=NEW.updated_at,updated_by=NEW.updated_by,version=version+1
    WHERE tenant_id=NEW.tenant_id AND reversed_by IS NULL AND unpriced_units<>0 AND deleted_at IS NULL
      AND id IN (SELECT id FROM package_transactions WHERE tenant_id=NEW.tenant_id AND package_id=NEW.id);
  INSERT INTO audit_log(tenant_id,id,at,actor_id,actor_label,module,action,entity_id,summary,before_json,after_json,money_version)
  VALUES(NEW.tenant_id,'aud_'||lower(hex(randomblob(12))),NEW.updated_at,NEW.updated_by,
    COALESCE((SELECT name FROM users WHERE tenant_id=NEW.tenant_id AND id=NEW.updated_by),'系统维护'),
    'tuition','price_completion',NEW.id,'补录课时单价并确认收入 '||changes()||' 笔',NULL,
    json_object('unit_price',NEW.unit_price,'booked_on',date(NEW.updated_at/1000,'unixepoch','+8 hours')),1);
END;
