# Derive single-statement dashboard files without splitting trigger bodies.
from pathlib import Path
import sqlite3,json,hashlib,re
root=Path('.');out=root/'deployment/upgrade-0022-0023';out.mkdir(parents=True,exist_ok=True)
steps=[]
for file in ['0022_content_and_ai.sql','0023_feedback_and_growth_reports.sql']:
 raw=(root/'migrations'/file).read_text();part='';items=[]
 for char in raw:
  part+=char
  if char==';' and sqlite3.complete_statement(part):items.append(part.strip()+'\n');part=''
 assert not re.sub(r'--[^\n]*','',part).strip(),part
 folder=out/file[:4];folder.mkdir(exist_ok=True)
 for i,sql in enumerate(items,1):
  path=folder/(str(i).zfill(2)+'.sql');path.write_text(sql);steps.append({'migration':file,'step':i,'path':str(path.relative_to(out)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
(out/'步骤清单.json').write_text(json.dumps({'status':'local_rehearsal_only_not_executed_remotely','migrations':[{'file':n,'sha256':hashlib.sha256((root/'migrations'/n).read_bytes()).hexdigest()} for n in ['0022_content_and_ai.sql','0023_feedback_and_growth_reports.sql']],'steps':steps},ensure_ascii=False,indent=2)+'\n')
(out/'01_升级前结构检查.sql').write_text("-- 只读。先看现有对象，不能据单个对象存在就认定整份迁移完成。\nSELECT type,name FROM sqlite_master WHERE name IN('tenants','plans','lesson_submissions','lesson_comments','content_items','content_revisions','ai_settings','ai_quota_daily','ai_requests','ai_quota_holds','ai_usage','growth_repertoire','growth_feedback_copies','growth_batches','growth_reports','growth_report_revisions','growth_notifications','growth_feedback') ORDER BY name;\nPRAGMA table_info('lesson_submissions');\nPRAGMA table_info('lesson_comments');\n")
# All these tables exist at 0021. Never run on a fresh/earlier database.
legacy=['tenants','users','students','teachers','course_types','lessons','lesson_submissions','submission_people','lesson_comments','plans','plan_revisions','packages','package_transactions','student_payments']
(out/'02_升级前后业务数量对照.sql').write_text('-- 只读。仅在确认已完成0021的同一数据库执行，升级前保存结果，升级后再次对照。\n'+' UNION ALL\n'.join("SELECT '"+t+"' entity,COUNT(*) row_count FROM "+t for t in legacy)+';\n')
whole=sqlite3.connect(':memory:');split=sqlite3.connect(':memory:')
for db in [whole,split]:
 db.execute('PRAGMA foreign_keys=ON')
 for path in sorted((root/'migrations').glob('*.sql')):
  if int(path.name[:4])<=21:db.executescript(path.read_text())
for f in ['0022_content_and_ai.sql','0023_feedback_and_growth_reports.sql']:whole.executescript((root/'migrations'/f).read_text())
for item in steps:split.execute((out/item['path']).read_text())
schema=lambda db:db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
assert schema(whole)==schema(split)
expected=[(kind,name) for kind,name,_ in schema(whole) if name.startswith(('growth_', 'content_', 'ai_')) or name in ('style_version_immutable','plan_style_version_immutable')]
values=',\n'.join("('"+t+"','"+n+"')" for t,n in expected)
check="-- 只读：missing_object应无结果；两列新增字段见PRAGMA；quick_check为ok；foreign_key_check无结果。\nWITH expected(type,name) AS(VALUES\n"+values+") SELECT e.type,e.name missing_object FROM expected e LEFT JOIN sqlite_master s ON s.type=e.type AND s.name=e.name WHERE s.name IS NULL;\nPRAGMA table_info('lesson_submissions');\nPRAGMA table_info('lesson_comments');\nPRAGMA quick_check;\nPRAGMA foreign_key_check;\n"
(out/'03_升级后完整性检查.sql').write_text(check)
for filename in ['01_升级前结构检查.sql','02_升级前后业务数量对照.sql','03_升级后完整性检查.sql']:
 sql=(out/filename).read_text();buffer=''
 for c in sql:
  buffer+=c
  if c==';' and sqlite3.complete_statement(buffer):split.execute(buffer).fetchall();buffer=''
 assert not split.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps({'result':'pass','single_statement_steps':len(steps),'steps_by_migration':{n:sum(x['migration'].startswith(n) for x in steps) for n in ['0022','0023']},'trigger_bodies_kept_whole':True,'whole_and_single_statement_schema_equal':True,'read_only_queries_executed':True,'foreign_keys':0,'remote_execution':False},ensure_ascii=False,indent=2))
