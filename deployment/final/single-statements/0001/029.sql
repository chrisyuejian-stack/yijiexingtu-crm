CREATE TRIGGER setup_permanent AFTER INSERT ON platform_admins BEGIN INSERT OR IGNORE INTO platform_state(id,value) VALUES('initialized','1'); END;
