CREATE INDEX renewal_reminders_scope ON renewal_reminders(tenant_id,student_id,scope_kind,scope_id,sent_at) WHERE deleted_at IS NULL;
