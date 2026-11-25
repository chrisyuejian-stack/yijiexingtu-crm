CREATE INDEX ai_pending_user ON ai_requests(tenant_id,user_id,status,deadline_at);
