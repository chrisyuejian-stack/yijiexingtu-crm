from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib,json,shutil
r=Path(__file__).resolve().parent.parent;o=r/'outputs/第十阶段C1';o.mkdir(parents=True,exist_ok=True);report=r/'work/reports/c1';kit=r/'outputs/全新部署'
def files(p):return sorted(x for x in p.rglob('*') if x.is_file() and '__pycache__' not in x.parts)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def zipto(dest,entries):
 with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=9) as z:
  for p,n in sorted(entries,key=lambda x:x[1]):
   i=ZipInfo(n,(2026,11,4,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())
def manifest(folder):
 rows={p.relative_to(folder).as_posix():sha(p) for p in files(folder) if p.name not in ['SHA256.txt','SHA256.json']}
 (folder/'SHA256.txt').write_text(''.join(h+'  '+n+'\n'for n,h in sorted(rows.items())));(folder/'SHA256.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');return rows
source=[(p,p.relative_to(r).as_posix())for folder in ['src','scripts','tests','migrations','docs','tools','dev']for p in files(r/folder)]+[(r/n,n)for n in ['README.md','package.json']]
current={n:p.read_bytes()for p,n in source}
with ZipFile(r/'outputs/第十阶段B验收后修正/B验收后修正源码.zip')as z:
 prior={n:z.read(n)for n in z.namelist()if n.startswith(tuple(x+'/'for x in ['src','scripts','tests','migrations','docs','tools','dev']))or n in ['README.md','package.json']}
 protected=[n for n in prior if n.startswith(('migrations/','src/console/')) or n in ['src/ui/tokens.css','src/server/permissions.js','src/server/auth.js','src/server/config.js','src/server/backup.js','src/server/backup-worker.js','src/server/crypto.js','src/server/numbers.js','src/server/finance.js','src/server/security.js','src/server/d1-limits.js','src/server/xlsx.js','src/server/imports.js','src/server/promo.js']]
 for n in protected:assert prior[n]==current[n],n
 changes={'baseline':'B验收后修正源码.zip','modified':sorted(n for n in prior if n in current and prior[n]!=current[n]),'added':sorted(n for n in current if n not in prior),'removed':sorted(n for n in prior if n not in current)}
(o/'修改文件清单.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
for n in ['source.txt','bundle.txt']:assert 'ℹ pass 140' in(report/n).read_text()and'ℹ fail 0'in(report/n).read_text(),n
assert json.loads((report/'browser.json').read_text())['failed']==0
assert json.loads((report/'components.json').read_text())['failed']==0
assert len(files(r/'dist'))==11
for p in files(r/'dist'):
 if p.suffix in ['.js','.html','.css']:assert all(x not in p.read_text()for x in ['MockPass2026x','MOCK_NOW','zz-mock-preview','教务模拟数据_100人']),p
zipto(o/'Pages最终上传包.zip',[(p,p.relative_to(r/'dist').as_posix())for p in files(r/'dist')])
shutil.copyfile(r/'backup-dist/backup-worker.js',o/'backup-worker.js')
for n,label in {'source.txt':'源码全套测试.txt','bundle.txt':'构建产物全套测试.txt','build.txt':'构建输出.txt','browser.txt':'浏览器逐页原始输出.txt','browser.json':'浏览器逐页结果.json','components.txt':'组件与顶栏原始输出.txt','components.json':'组件与顶栏结果.json','mock.txt':'模拟数据导入原始输出.txt','mock-todo.json':'模拟数据待办计数.json','query-source.json':'源码全部接口查询预算.json','query-bundle.json':'打包全部接口查询预算.json'}.items():shutil.copyfile(report/n,o/label)
for n,label in [('isolation-stage8-source.json','源码HTTP隔离.json'),('isolation-stage8-bundle.json','打包HTTP隔离.json')]:
 data=json.loads((r/'work/reports'/n).read_text());assert data['summary']=={'passed':41,'failed':0,'not_implemented':0};shutil.copyfile(r/'work/reports'/n,o/label)
for p in (r/'docs').glob('第十阶段C1*.md'):shutil.copyfile(p,o/p.name)
shutil.copyfile(r/'docs/全新部署手册.md',o/'全新部署手册.md')
budget=json.loads((report/'query-source.json').read_text());assert budget['maximum']<=40
verification={'phase':'第十阶段C1','pages_files':11,'pages_sha256':sha(o/'Pages最终上传包.zip'),'source_tests':140,'bundle_tests':140,'baseline_tests':132,'new_tests':8,'browser_pages':116,'browser_component_cases':7,'isolation_source':41,'isolation_bundle':41,'query_interfaces':len(budget['interfaces']),'query_maximum':budget['maximum'],'business_queries_85_lessons':{'schedule':2,'data/lessons':3},'protected_files_equal_B':protected,'new_migrations':0,'backend_permission_model_unchanged':True,'backup_business_source_changed':False,'backup_compiled_bytes_changed':True,'backup_existing_deployment_required':False,'backup_release_sha256':sha(o/'backup-worker.js'),'mock_in_dist':False,'cloud_deployed':False,'wechat_real_device':False,'next_phase_started':False}
(o/'部署资料核验.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
shots=r/'work/screenshots/c1';zipto(o/'C1五角色逐页截图.zip',[(p,p.relative_to(shots).as_posix())for p in files(shots)if not p.name.startswith('failure-')])
# Source contains final source/build/HTTP evidence; independent extraction logs are delivered alongside after verification.
source.extend((o/n,'验收结果/'+n)for n in ['源码全套测试.txt','构建产物全套测试.txt','构建输出.txt','源码全部接口查询预算.json','打包全部接口查询预算.json','源码HTTP隔离.json','打包HTTP隔离.json','部署资料核验.json','修改文件清单.json'])
zipto(o/'第十阶段C1源码.zip',source)
# Synchronize the sole new-environment kit. Existing installs do not need a backup replacement.
shutil.copyfile(o/'Pages最终上传包.zip',kit/'Pages最终上传包.zip');shutil.copyfile(o/'backup-worker.js',kit/'backup-worker.js');shutil.copyfile(r/'docs/全新部署手册.md',kit/'全新部署手册.md');(kit/'部署资料核验.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n');manifest(kit);zipto(r/'outputs/全新部署资料包.zip',[(p,p.relative_to(kit).as_posix())for p in files(kit)]);(r/'outputs/全新部署资料包.SHA256.txt').write_text(sha(r/'outputs/全新部署资料包.zip')+'  全新部署资料包.zip\n')
rows=manifest(o);print(json.dumps({'output':str(o),'archives':{n:h for n,h in rows.items()if n.endswith('.zip')}},ensure_ascii=False,indent=2))
