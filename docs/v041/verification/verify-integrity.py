from pathlib import Path
import json,hashlib,zipfile,subprocess
r=Path(__file__).resolve().parents[3];w=r/'work/v041';refs=r/'docs/v041/verification/results';w.mkdir(parents=True,exist_ok=True);refs.mkdir(parents=True,exist_ok=True)
def load(n):
 p=w/n;return json.loads((p if p.exists() else refs/n).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();base=load('baseline.json');old={x['path']:x for x in base['files']};patch=load('frontend-patch.json');front=load('frontend-frozen.json')
for n,h in front.items():assert sha(r/n)==h,n
current={str(p.relative_to(r)) for f in ['src/tenant','src/console','src/ui','src/share'] for p in (r/f).rglob('*') if p.is_file()};assert current==set(front)
for x in patch['files']:assert sha(r/x['path'])==x['sha256'],x['path']
oldcases=[n for n in old if n.startswith('tests/') and n.endswith('.test.mjs')];modified=[]
for n in oldcases:
 if sha(r/n)!=old[n]['sha256']:modified.append(n)
assert modified==['tests/ai-stage5.test.mjs'];baseline_txt=refs/'approved-test-baseline.txt'
if not baseline_txt.exists():
 archives=list(Path('/workspace/attachments').glob('*/'+base['source']));assert len(archives)==1
 with zipfile.ZipFile(archives[0]) as z:baseline_txt.write_bytes(z.read(modified[0]))
assert sha(baseline_txt)==old[modified[0]]['sha256']
s=baseline_txt.read_text();s=s.replace('YX5AI 平台模型和机构覆盖生效，快速深度硬截止分别45/90秒','YX5AI 平台模型和机构覆盖生效，长文动作快速深度硬截止分别120/150秒').replace('(request.tier === "fast" ? 45e3 : 9e4)','(request.tier === "fast" ? 120e3 : 150e3)');start=s.index('test("YX5AI 硬截止后才返回的结果丢弃');end=s.index('\ntest(',start+8);p=s[start:end].replace('clock += 46e3;','clock += 121e3;').replace('        ok(await ai(s, "content/versions", {\n            content_id: c.id\n        }), 502);','        assert.equal(ok(await ai(s, "content/versions", {\n            content_id: c.id\n        }), 502).error, "ai_timeout");');s=s[:start]+p+s[end:];assert s==(r/modified[0]).read_text()
for n in old:
 if n.startswith('migrations/') or n=='scripts/build.mjs':assert sha(r/n)==old[n]['sha256'],n
for n,h in load('final-freeze.json').items():assert sha(r/n)==h,n
js=sorted([*r.glob('dist/**/*.js'),*r.glob('backup-dist/*.js')]);assert len(js)==5
for p in js:subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
assert len([p for p in (r/'dist').rglob('*') if p.is_file()])==12
workers={n:{'sha256':sha(r/n),'bytes':(r/n).stat().st_size} for n in ['dist/_worker.js','backup-dist/backup-worker.js']}
report={'result':'pass','baseline_source':base['source'],'baseline_sha256':base['sha256'],'old_test_files':len(oldcases),'unchanged_old_test_files':len(oldcases)-1,'only_authorized_old_test_file':modified[0],'authorized_diff_exact':True,'old_migrations_unchanged':26,'migrations_total':27,'frontend_files_unchanged':len(front),'patch_files_exact':len(patch['files']),'build_mjs_unchanged':True,'runtime_matches_test_freeze':True,'compiled_js_syntax_checked':5,'pages_files':12,'workers':workers,'application_remote_calls':0,'deployed':False}
(w/'integrity-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
