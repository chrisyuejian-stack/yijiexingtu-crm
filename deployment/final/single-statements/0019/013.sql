CREATE INDEX identity_login_history ON auth_log(tenant_id,user_id,event,at);
