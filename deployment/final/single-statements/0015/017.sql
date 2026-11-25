-- A request that was already in flight must not recreate tenant records
-- after the final scan on tables that have no tenant foreign key.
CREATE TRIGGER purged_auth_insert_guard BEFORE INSERT ON auth_log
WHEN NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
