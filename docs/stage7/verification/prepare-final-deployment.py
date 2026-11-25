from pathlib import Path
import json,sqlite3,re,hashlib,shutil,subprocess
root=Path(__file__).resolve().parents[3];out=root/'deployment/final';out.mkdir(parents=True,exist_ok=True)
rawdir=out/'migrations';rawdir.mkdir(exist_ok=True);steps=[];migrations=[]
for file in sorted((root/'migrations').glob('*.sql')):
 shutil.copyfile(file,rawdir/file.name)
 raw=file.read_text();buf='';items=[]
 for c in raw:
  buf+=c
  if c==';' and sqlite3.complete_statement(buf):items.append(buf.strip()+'\n');buf=''
 assert not re.sub(r'--[^\n]*','',buf).strip(),file
 folder=out/'single-statements'/file.name[:4];folder.mkdir(parents=True,exist_ok=True)
 for i,sql in enumerate(items,1):
  p=folder/(f'{i:03}.sql');p.write_text(sql);steps.append({'migration':file.name,'number':int(file.name[:4]),'step':i,'path':str(p.relative_to(out)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sql':sql})
 migrations.append({'file':file.name,'number':int(file.name[:4]),'steps':len(items),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
manifest={'status':'local_verified_not_deployed','date':'2026-11-16','migrations':migrations,'steps':[{k:v for k,v in x.items() if k!='sql'} for x in steps]};(out/'迁移与步骤清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
whole=sqlite3.connect(':memory:');split=sqlite3.connect(':memory:')
for db in [whole,split]:db.execute('PRAGMA foreign_keys=ON')
for file in sorted(rawdir.glob('*.sql')):whole.executescript(file.read_text())
for step in steps:split.execute(step['sql'])
schema=lambda db:db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
assert schema(whole)==schema(split);assert not split.execute('PRAGMA foreign_key_check').fetchall();assert split.execute('PRAGMA quick_check').fetchall()==[('ok',)]
checks=out/'readonly-checks';checks.mkdir(exist_ok=True)
(checks/'01_结构识别.sql').write_text("-- 只读：对象名不足以证明整份迁移已完成，应同时对照升级记录和最后成功步骤。\nSELECT type,name FROM sqlite_master WHERE name IN('plans','content_items','content_revisions','ai_requests','ai_settings','ai_quota_daily','growth_reports','growth_feedback','growth_batches','subject_packs','subject_pack_versions','style_assets','style_version_meta','style_version_tenants','style_defaults','setting_template_refs','platform_ops_guards') ORDER BY name;\nPRAGMA table_info('lesson_submissions');\nPRAGMA table_info('lesson_comments');\n")
legacy=['tenants','users','students','teachers','course_types','lessons','lesson_submissions','submission_people','lesson_comments','plans','plan_revisions','packages','package_transactions','student_payments']
(checks/'02_原业务数量对照.sql').write_text('-- 只读：适用于已完整到0021及之后的数据库；保存升级前后结果。停写期间数量应一致。\n'+' UNION ALL\n'.join("SELECT '"+t+"' entity,COUNT(*) row_count FROM "+t for t in legacy)+';\n')
expected=[(kind,name) for kind,name,_ in schema(whole)];values=',\n'.join("('"+t+"','"+n+"')" for t,n in expected)
(checks/'03_最终对象完整性.sql').write_text('-- 只读：missing_object应无结果；仍须核对列和索引定义，不以存在性代替全部迁移记录。\nWITH expected(type,name) AS(VALUES\n'+values+") SELECT e.type,e.name missing_object FROM expected e LEFT JOIN sqlite_master s ON s.type=e.type AND s.name=e.name WHERE s.name IS NULL;\nPRAGMA table_info('lesson_submissions');\nPRAGMA table_info('lesson_comments');\nPRAGMA table_info('subject_pack_versions');\nPRAGMA quick_check;\nPRAGMA foreign_key_check;\n")
(checks/'04_平台种子核对.sql').write_text("-- 只读：应有4学科，每个0.1为published，4种文档默认风格；版本数可以因后续正常运营增加。\nSELECT key,name,current_published_version FROM subject_packs ORDER BY key;\nSELECT key,pack_version,version,status FROM subject_pack_versions ORDER BY key,pack_version;\nSELECT doc_type,pack_id FROM style_defaults ORDER BY doc_type;\nSELECT COUNT(*) pending_guard_rows FROM platform_ops_guards;\n")
(checks/'05_最近备份.sql').write_text("-- 只读；按实际列名展示最近备份日志，查找成功记录并与备份桶manifest.enc对应。\nSELECT id,at,status,detail FROM backup_runs ORDER BY at DESC LIMIT 10;\n")
for p in checks.glob('*.sql'):
 buf=''
 for c in p.read_text():
  buf+=c
  if c==';' and sqlite3.complete_statement(buf):split.execute(buf).fetchall();buf=''
helper=out/'离线升级助手';helper.mkdir(exist_ok=True)
(helper/'steps.js').write_text('window.UPGRADE_DATA='+json.dumps({'migrations':migrations,'steps':steps},ensure_ascii=False,separators=(',',':'))+';\n')
(helper/'打开升级助手.html').write_text('''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>艺界星途 · 离线升级助手</title><link rel="stylesheet" href="helper.css"><script src="steps.js" defer></script><script src="helper.js" defer></script></head><body><main><h1>艺界星途 · 离线升级助手</h1><p>仅在本机显示SQL，无网络请求，不连接数据库。先阅读《逐步上线清单》，确认备份、停写和数据库名称。这里的“已执行”只是手工记录，不能证明云端执行成功。</p><label>已经完整完成的数据库版本 <select id="current"><option value="23">0023（已验收阶段6）</option><option value="22">0022</option><option value="21">0021（阶段4）</option><option value="24">0024（最终版，无需重复升级）</option><option value="0">全新空库（依次0001–0024）</option></select></label><button id="start">生成后续步骤</button><p>不知道版本或上次只执行一部分：先停下，交后端核对，不要猜选。</p><hr><p id="summary"></p><label>当前步骤 <select id="step"></select></label><p id="detail"></p><textarea id="sql" readonly spellcheck="false" aria-label="完整SQL"></textarea><div><button id="copy">复制完整SQL</button><button id="done">云端已成功，记下并进入下一步</button></div><p id="notice" role="status"></p><h2>本次手工记录</h2><textarea id="history" readonly aria-label="本次手工执行记录"></textarea><button id="save">下载记录</button><p>每次只执行这里显示的一个完整语句。触发器BEGIN…END必须整体复制。云端报错时立即停止，保存错误、数据库ID及本记录；不跳步、不重复从头执行。</p></main></body></html>''')
(helper/'helper.css').write_text('body{font:16px/1.7 system-ui,sans-serif;color:#172333;background:#f5f7fb;margin:0}main{max-width:980px;margin:auto;padding:30px}select,button,textarea{font:inherit;padding:8px;margin:6px 4px 6px 0}textarea{box-sizing:border-box;width:100%;height:340px;font:14px/1.6 monospace;background:white}#history{height:120px}button{cursor:pointer}#notice{font-weight:bold}label{display:block}hr{margin:24px 0}')
(helper/'helper.js').write_text('''"use strict";
const by=id=>document.getElementById(id);let selected=[],position=0,history=[];
function display(){const s=selected[position];by("step").value=String(position);by("sql").value=s?.sql||"";by("detail").textContent=s?`${s.migration} · 第${s.step}步 · SHA-256 ${s.sha256}`:"没有待执行步骤。";by("done").disabled=!s;by("copy").disabled=!s;by("history").value=history.join("\\n");}
by("start").addEventListener("click",()=>{if(history.length&&!confirm("重新选择会清空本次手工记录，请先下载。继续？"))return;const current=Number(by("current").value);selected=window.UPGRADE_DATA.steps.filter(s=>s.number>current);position=0;history=[];by("step").replaceChildren(...selected.map((s,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=`${i+1}/${selected.length} · ${s.migration} / ${s.step}`;return o}));by("summary").textContent=`完整起点：${current}；后续共${selected.length}个完整语句。请逐步在已核对的D1 Console执行。`;by("notice").textContent="已准备。先复制本步，云端成功后再记录。";display()});
by("step").addEventListener("change",()=>{position=Number(by("step").value);display()});
by("copy").addEventListener("click",async()=>{by("sql").focus();by("sql").select();try{await navigator.clipboard.writeText(by("sql").value);by("notice").textContent="已复制；到Cloudflare D1 Console粘贴并执行。"}catch{by("notice").textContent="浏览器限制自动复制：SQL已全选，请用右键菜单复制。"}});
by("done").addEventListener("click",()=>{const s=selected[position];if(!s)return;history.push(`${new Date().toISOString()} 用户手工标记成功 ${s.migration} 第${s.step}步 ${s.sha256}`);position++;if(position>=selected.length){position=selected.length;by("notice").textContent="已手工记录到最后一步；请执行只读完整性检查并下载记录。"}else by("notice").textContent="已记录上一语句成功。请复制新的当前步骤。";display()});
by("save").addEventListener("click",()=>{const a=document.createElement("a"),url=URL.createObjectURL(new Blob([by("summary").textContent+"\\n"+history.join("\\n")],{type:"text/plain;charset=utf-8"}));a.href=url;a.download="艺界星途_升级手工记录.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});by("start").click();
''')
for p in [helper/'helper.js',helper/'steps.js']:subprocess.run(['node','--check',str(p)],check=True)
report={'result':'pass','migrations':len(migrations),'single_statements':len(steps),'steps_for_0022_0023_0024':{str(n):sum(s['number']==n for s in steps) for n in [22,23,24]},'trigger_bodies_kept_whole':True,'whole_and_split_schema_equal':True,'foreign_key_check':[],'quick_check':'ok','readonly_queries_executed':len(list(checks.glob('*.sql'))),'helper_javascript_syntax':'pass','remote_execution':False}
(root/'work/stage7/implementation').mkdir(parents=True,exist_ok=True)
(root/'work/stage7/implementation/deployment-sql-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
