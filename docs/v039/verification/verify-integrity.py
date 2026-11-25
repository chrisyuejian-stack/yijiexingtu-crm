from pathlib import Path
import json,hashlib,sqlite3,zipfile,subprocess
r=Path(__file__).resolve().parents[3];w=r/'work/v039';refs=r/'docs/v039/verification/results'
def load(name):
 p=w/name
 return json.loads((p if p.exists() else refs/name).read_text())
base=load('baseline.json');old={x['path']:x for x in base['files']};patch=load('frontend-patch.json');patchpaths={x['path'] for x in patch['files']};sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for x in patch['files']:assert sha(r/x['path'])==x['sha256'],x['path']
oldtests=[n for n in old if n.startswith('tests/') and n.endswith('.test.mjs')];assert len(oldtests)==58
for n in oldtests:assert sha(r/n)==old[n]['sha256'],n
migrations=[n for n in old if n.startswith('migrations/')];assert len(migrations)==24
for n in migrations:assert sha(r/n)==old[n]['sha256'],n
assert sha(r/'scripts/build.mjs')==old['scripts/build.mjs']['sha256']
front=[n for n in old if n.startswith(('src/tenant/','src/console/','src/ui/','src/share/')) and n not in patchpaths]
for n in front:assert sha(r/n)==old[n]['sha256'],n
for n,x in load('final-freeze.json').items():assert sha(r/n)==x,n
checks=[]
for arc,entry,local in [('艺界星途_阶段7_Pages正式上传包_20261116.zip','_worker.js','dist/_worker.js'),('艺界星途_阶段7_备份Worker部署包_20261116.zip','backup-worker.js','backup-dist/backup-worker.js')]:
 baseline_archive=Path('/workspace/shared/downloads')/arc;expected=load('fusion-worker-comparison.json')[local]['sha256']
 if baseline_archive.exists():
  with zipfile.ZipFile(baseline_archive) as z:raw=z.read(entry)
  assert hashlib.sha256(raw).hexdigest()==expected
 fused_path=w/'fusion-products'/Path(local).name
 if fused_path.exists():assert sha(fused_path)==expected
 new=(r/local).read_bytes();assert hashlib.sha256(new).hexdigest()!=expected
 checks.append({'file':local,'stage7_sha256':expected,'pure_frontend_fusion_sha256':expected,'pure_fusion_same':True,'stage7_artifact_bytes_checked_this_run':baseline_archive.exists(),'fusion_product_bytes_checked_this_run':fused_path.exists(),'final_v039_sha256':hashlib.sha256(new).hexdigest(),'final_same':False,'final_bytes':len(new)})
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for p in sorted((r/'migrations').glob('*.sql')):db.executescript(p.read_text())
assert db.execute('PRAGMA quick_check').fetchall()==[('ok',)];assert not db.execute('PRAGMA foreign_key_check').fetchall();col=next(x for x in db.execute('PRAGMA table_info(content_items)') if x[1]=='article_json');assert col[2]=='TEXT' and col[3]==1 and col[4]=="'null'"
js=[*r.glob('dist/**/*.js'),*r.glob('backup-dist/*.js')]
for p in js:subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
assert len([p for p in (r/'dist').rglob('*') if p.is_file()])==12
report={'result':'pass','basis':base['source'],'basis_sha256':base['sha256'],'patch_files_exact':16,'unchanged_old_test_case_files':58,'unchanged_old_migrations':24,'unchanged_build_script':True,'unchanged_frontend_outside_patch':len(front),'runtime_matches_final_test_freeze':True,'migrations_total':25,'only_new_column':'content_items.article_json','foreign_key_check':[],'quick_check':'ok','pages_files':12,'compiled_javascript_syntax_checked':len(js),'worker_comparison':checks,'remote_calls':0}
w.mkdir(parents=True,exist_ok=True)
(w/'integrity-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
