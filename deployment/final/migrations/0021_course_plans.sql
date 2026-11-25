-- 艺界星途阶段4：课程方案；0001–0020保持原样。
CREATE TABLE plans(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,student_id TEXT,source_lead_id TEXT,subject TEXT NOT NULL,title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','sent','signed','archived')),
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),context_id TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 current_revision_id TEXT,sent_revision_id TEXT,signed_revision_id TEXT,signed_at INTEGER,archived_at INTEGER,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),CHECK(student_id IS NOT NULL OR source_lead_id IS NOT NULL));
CREATE INDEX plans_list ON plans(tenant_id,status,updated_at DESC,id);
CREATE INDEX plans_student ON plans(tenant_id,student_id,deleted_at);
CREATE INDEX plans_lead ON plans(tenant_id,source_lead_id,deleted_at);
CREATE TABLE plan_contexts(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),created_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
CREATE TABLE plan_revisions(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,seq INTEGER NOT NULL,student_id TEXT,source_lead_id TEXT,
 doc_json TEXT NOT NULL CHECK(json_valid(doc_json)),context_id TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),image_ids_json TEXT NOT NULL CHECK(json_valid(image_ids_json)),
 action TEXT NOT NULL,sent_at INTEGER,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,plan_id,seq),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),FOREIGN KEY(tenant_id,context_id) REFERENCES plan_contexts(tenant_id,id));
CREATE INDEX plan_revision_history ON plan_revisions(tenant_id,plan_id,seq DESC);
CREATE INDEX plan_revision_student ON plan_revisions(tenant_id,student_id,id);
CREATE TABLE plan_elements(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('stage','line')),target_id TEXT,snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json)),created_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id));
CREATE INDEX plan_element_owner ON plan_elements(tenant_id,plan_id,kind);
CREATE TABLE share_links(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,plan_id TEXT NOT NULL,revision_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,revoked_at INTEGER,visits INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES plans(tenant_id,id),FOREIGN KEY(tenant_id,revision_id) REFERENCES plan_revisions(tenant_id,id));
CREATE INDEX plan_share_list ON share_links(tenant_id,plan_id,created_at DESC);
CREATE TABLE style_packs(id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,scope_all INTEGER NOT NULL DEFAULT 1,default_plan INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE TABLE style_pack_versions(id TEXT NOT NULL UNIQUE,pack_id TEXT NOT NULL REFERENCES style_packs(id),version TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),created_at INTEGER NOT NULL,PRIMARY KEY(pack_id,version));
CREATE TABLE style_pack_scopes(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,pack_id TEXT NOT NULL REFERENCES style_packs(id),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,pack_id));
CREATE TABLE compliance_terms(id TEXT PRIMARY KEY,term TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE tenant_compliance_terms(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,term TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,term));
CREATE TRIGGER plan_revision_immutable BEFORE UPDATE ON plan_revisions BEGIN SELECT RAISE(ABORT,'plan_revision_immutable'); END;
CREATE TRIGGER plan_context_immutable BEFORE UPDATE ON plan_contexts BEGIN SELECT RAISE(ABORT,'plan_context_immutable'); END;
CREATE TRIGGER plan_style_version_immutable BEFORE UPDATE ON style_pack_versions BEGIN SELECT RAISE(ABORT,'style_version_immutable'); END;
CREATE TRIGGER plan_element_identity BEFORE UPDATE ON plan_elements WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.id IS NOT NEW.id OR OLD.plan_id IS NOT NEW.plan_id OR OLD.kind IS NOT NEW.kind OR (OLD.kind='line' AND OLD.target_id IS NOT NEW.target_id) BEGIN SELECT RAISE(ABORT,'plan_element_identity'); END;
INSERT INTO style_packs(id,name,current_version,default_plan,created_at)VALUES('stp_stage','舞台','1.0.0',0,0);
INSERT INTO style_pack_versions(id,pack_id,version,manifest_json,created_at)VALUES('sv_stp_stage','stp_stage','1.0.0','{"id":"stp_stage","name":"舞台","version":"1.0.0","doc_types":["plan"],"subjects":["*"],"tokens":{"color":{"primary":"#A3271F","ink":"#2B1A16","paper":"#FFF8F0","accent":"#F4C08A","muted":"#7A5A50","use_tenant_primary":true},"font":{"display":"noto-serif-sc","body":"noto-sans-sc","latin":"cormorant-italic"}},"components":{"plan.cover":"stage","plan.section_header":"numeral","plan.stage_block":"band","plan.total_card":"solid","report.header":"band","feedback_card.header":"plain"},"decor":{"cover_frame":"none"},"cover_text_modes":["auto","dark","light","panel"],"thumbnail":null}',0);
INSERT INTO style_packs(id,name,current_version,default_plan,created_at)VALUES('stp_folio','书册','1.0.0',1,0);
INSERT INTO style_pack_versions(id,pack_id,version,manifest_json,created_at)VALUES('sv_stp_folio','stp_folio','1.0.0','{"id":"stp_folio","name":"书册","version":"1.0.0","doc_types":["plan"],"subjects":["*"],"tokens":{"color":{"primary":"#A3271F","ink":"#2B1A16","paper":"#FFF8F0","accent":"#F4C08A","muted":"#7A5A50","use_tenant_primary":true},"font":{"display":"noto-serif-sc","body":"noto-sans-sc","latin":"cormorant-italic"}},"components":{"plan.cover":"folio","plan.section_header":"numeral","plan.stage_block":"band","plan.total_card":"solid","report.header":"band","feedback_card.header":"plain"},"decor":{"cover_frame":"none"},"cover_text_modes":["auto","dark","light","panel"],"thumbnail":null}',0);
INSERT INTO style_packs(id,name,current_version,default_plan,created_at)VALUES('stp_journal','手记','1.0.0',0,0);
INSERT INTO style_pack_versions(id,pack_id,version,manifest_json,created_at)VALUES('sv_stp_journal','stp_journal','1.0.0','{"id":"stp_journal","name":"手记","version":"1.0.0","doc_types":["plan"],"subjects":["*"],"tokens":{"color":{"primary":"#A3271F","ink":"#2B1A16","paper":"#FFF8F0","accent":"#F4C08A","muted":"#7A5A50","use_tenant_primary":true},"font":{"display":"noto-serif-sc","body":"noto-sans-sc","latin":"cormorant-italic"}},"components":{"plan.cover":"journal","plan.section_header":"numeral","plan.stage_block":"band","plan.total_card":"solid","report.header":"band","feedback_card.header":"plain"},"decor":{"cover_frame":"none"},"cover_text_modes":["auto","dark","light","panel"],"thumbnail":null}',0);
INSERT INTO compliance_terms(id,term)VALUES('term_0','包过');
INSERT INTO compliance_terms(id,term)VALUES('term_1','保录');
INSERT INTO compliance_terms(id,term)VALUES('term_2','100% 合格');
INSERT INTO compliance_terms(id,term)VALUES('term_3','第一');
INSERT INTO compliance_terms(id,term)VALUES('term_4','最好');
