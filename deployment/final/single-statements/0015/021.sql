CREATE TRIGGER purged_security_limit_insert_guard BEFORE INSERT ON security_limits
WHEN (NEW.key GLOB 'login:ten_*' OR NEW.key GLOB 'read:ten_*'
   OR NEW.key GLOB 'request:ten_*' OR NEW.key GLOB 'city:ten_*')
  AND NOT EXISTS(
    SELECT 1 FROM tenants WHERE id=substr(NEW.key,instr(NEW.key,':')+1,28)
  )
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
