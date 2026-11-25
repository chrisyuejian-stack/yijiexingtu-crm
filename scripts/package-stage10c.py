from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib,json,shutil,re
r=Path(__file__).resolve().parent.parent;o=r/'outputs/第十阶段C';o.mkdir(parents=True,exist_ok=True)
def files(p):return sorted(x for x in p.rglob('*') if x.is_file() and '__pycache__' not in x.parts and x.name!='.DS_Store')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def zipto(path,entries):
 with ZipFile(path,'w',ZIP_DEFLATED,compresslevel=9) as z:
  for p,n in sorted(entries,key=lambda x:x[1]):
   i=ZipInfo(n,(2026,11,5,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())
def copy(a,b):b.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(a,b)
def manifest(folder):
 rows={p.relative_to(folder).as_posix():sha(p)for p in files(folder)if p.name not in ['SHA256.txt','SHA256.json']}
 (folder/'SHA256.txt').write_text(''.join(h+'  '+n+'\n'for n,h in sorted(rows.items())));(folder/'SHA256.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');return rows
for phase,count in [('c1',140),('c2',144),('c3',152)]:
 for name in ['npm-source.txt','npm-bundle.txt']:
  text=(r/'work/reports'/phase/name).read_text();assert f'ℹ pass {count}'in text and'ℹ fail 0'in text,(phase,name)
for path in ['c1/browser.json','c1/components.json','c2/browser.json','c3/browser-source.json','c3/browser-bundle.json','c3/extra-browser.json','c3/compat-browser.json']:
 x=json.loads((r/'work/reports'/path).read_text());assert x['failed']==0,path
budget=json.loads((r/'work/reports/c3/query-source.json').read_text());assert budget['maximum']<=40
for mode in ['source','bundle']:
 x=json.loads((r/'work/reports'/f'isolation-stage8-{mode}.json').read_text());assert x['summary']=={'passed':41,'failed':0,'not_implemented':0}
assert len(files(r/'dist'))==11
for p in files(r/'dist'):
 if p.suffix in ['.js','.html','.css']:assert all(s not in p.read_text()for s in ['MockPass2026x','MOCK_NOW','zz-mock-preview','教务模拟数据_100人']),p
assert not list((r/'dist').rglob('*.map'))
# Compare with the accepted B baseline, without rewriting any prior artifact.
with ZipFile(r/'outputs/第十阶段B验收后修正/B验收后修正源码.zip')as z:
 prior={n:z.read(n) for n in z.namelist()if n.startswith(tuple(x+'/' for x in ['src','scripts','tests','migrations','docs','tools','dev'])) or n in ['README.md','package.json']}
source=[(p,p.relative_to(r).as_posix())for folder in ['src','scripts','tests','migrations','docs','tools','dev']for p in files(r/folder)]+[(r/n,n)for n in ['README.md','package.json']]
current={n:p.read_bytes()for p,n in source}
protected=[n for n in prior if n.startswith(('migrations/','src/console/'))or n in ['src/ui/tokens.css','src/server/auth.js','src/server/core.js','src/server/crypto.js','src/server/tenant.js','src/server/backup.js','src/server/d1-limits.js','src/server/xlsx.js','src/server/imports.js','src/server/promo.js','src/server/presentation.js']]
for n in protected:assert current[n]==prior[n],n
old_decision=prior['docs/已确认的需求决定.md'].decode().rstrip();assert current['docs/已确认的需求决定.md'].decode().split('\n## 21.')[0].rstrip()==old_decision
calc=lambda s:s[s.index('export function calculatePayroll('):s.index('function summaryReport(')].strip()
assert calc(current['src/server/finance.js'].decode())==calc(prior['src/server/finance.js'].decode()),'original payroll changed'
changes={'baseline':'第十阶段B验收后修正源码.zip','modified':sorted(n for n in prior if n in current and prior[n]!=current[n]),'added':sorted(n for n in current if n not in prior),'removed':sorted(n for n in prior if n not in current),'protected_unchanged':protected,'original_calculatePayroll_unchanged':True,'decisions_1_20_unchanged':True}
(o/'修改文件清单.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
zipto(o/'Pages最终上传包.zip',[(p,p.relative_to(r/'dist').as_posix())for p in files(r/'dist')])
# Evidence and screenshots are inside the single source archive, and also easy to inspect beside it.
ev=o/'验收结果';shots=o/'验收截图'
for phase in ['c1','c2','c3']:
 names=['npm-source.txt','npm-bundle.txt','browser.txt','browser.json']
 if phase=='c1':names+=['components.txt','components.json','query-source.json','query-bundle.json','mock.txt']
 if phase=='c3':names+=['build.txt','query-source.json','query-bundle.json','browser-source.json','browser-source.txt','browser-bundle.json','browser-bundle.txt','extra-browser.json','extra-browser.txt','compat-browser.json','compat-browser.txt','mock-current.txt','mock-bundle-final.txt']
 for name in names:
  p=r/'work/reports'/phase/name
  if p.exists():copy(p,ev/phase.upper()/name)
for mode in ['source','bundle']:copy(r/'work/reports'/f'isolation-stage8-{mode}.json',ev/'C3'/f'HTTP隔离-{mode}.json')
with ZipFile(r/'outputs/第十阶段C1/C1五角色逐页截图.zip')as z:
 for n in z.namelist():
  if n.endswith('/')or Path(n).name.startswith('failure-'):continue
  assert not Path(n).is_absolute()and'..'not in Path(n).parts
  p=shots/'C1'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(n))
for phase in ['C2','C3']:
 for p in files(r/'work/screenshots/C'/phase):
  if p.suffix.lower()=='.png'and not p.name.startswith('failure-'):copy(p,shots/phase/p.relative_to(r/'work/screenshots/C'/phase))
for p in (r/'docs').glob('第十阶段C*.md'):copy(p,o/p.name)
copy(r/'docs/全新部署手册.md',o/'全新部署手册.md')
copy(r/'backup-dist/backup-worker.js',o/'backup-worker.js')
verification={'phase':'第十阶段C（C1/C2/C3）','source_tests':152,'bundle_tests':152,'per_round_gate':{'C1':{'tests':140,'new':8},'C2':{'tests':144,'new':4},'C3':{'tests':152,'new':8}},'isolation':{'source':41,'bundle':41,'not_implemented':0},'query_interfaces':len(budget['interfaces']),'query_maximum':budget['maximum'],'query_limit':40,'pages_files':11,'pages_sha256':sha(o/'Pages最终上传包.zip'),'protected_files_equal_B':protected,'new_migrations':0,'original_calculatePayroll_unchanged':True,'decisions_1_20_unchanged':True,'backup_business_source_changed':False,'backup_existing_deployment_required':False,'backup_rebuilt_sha256':sha(o/'backup-worker.js'),'console_ui_changed':False,'tokens_changed':False,'wechat_real_device_tested':False,'cloud_deployed':False,'next_phase_started':False,'browser':{p:len(json.loads((r/'work/reports'/p).read_text())['results'])for p in ['c1/browser.json','c1/components.json','c2/browser.json','c3/browser-source.json','c3/browser-bundle.json','c3/extra-browser.json','c3/compat-browser.json']}}
(o/'部署资料核验.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
source.extend((p,'验收结果/'+p.relative_to(ev).as_posix())for p in files(ev));source.extend((p,'验收截图/'+p.relative_to(shots).as_posix())for p in files(shots));source.extend((o/n,'验收结果/'+n)for n in ['部署资料核验.json','修改文件清单.json'])
zipto(o/'第十阶段C源码.zip',source)
# Synchronize the existing sole new-environment kit; keep only the two requested ZIPs in this delivery folder.
kit=r/'outputs/全新部署';copy(o/'Pages最终上传包.zip',kit/'Pages最终上传包.zip');copy(o/'backup-worker.js',kit/'backup-worker.js');copy(r/'docs/全新部署手册.md',kit/'全新部署手册.md');copy(o/'部署资料核验.json',kit/'部署资料核验.json');manifest(kit)
zipto(r/'outputs/全新部署资料包.zip',[(p,p.relative_to(kit).as_posix())for p in files(kit)]);(r/'outputs/全新部署资料包.SHA256.txt').write_text(sha(r/'outputs/全新部署资料包.zip')+'  全新部署资料包.zip\n')
rows=manifest(o);print(json.dumps({'output':str(o),'archives':{n:h for n,h in rows.items()if n.endswith('.zip')},'screenshots':len(files(shots))},ensure_ascii=False,indent=2))
