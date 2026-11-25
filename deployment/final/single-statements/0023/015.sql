CREATE UNIQUE INDEX growth_publication_order ON growth_report_revisions(tenant_id,publication_order) WHERE publication_order IS NOT NULL;
