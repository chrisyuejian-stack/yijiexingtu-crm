INSERT INTO tenant_modules(tenant_id,id,enabled,created_at,created_by,updated_at,updated_by)
 SELECT t.id,j.value,CASE WHEN j.value='school_db' THEN 0 ELSE 1 END,t.updated_at,'system',t.updated_at,'system'
 FROM tenants t CROSS JOIN json_each('["content","plans","growth_reports","school_db","prices","feedback","parents","ai","usage"]') j;
