# coding: utf-8
"""D1真实限制修复交付，确定性ZIP；同时更新Pages、备份Worker及从零部署资料。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, shutil
root=Path(__file__).resolve().parent.parent
out=root/'outputs/第九阶段小改动三'; kit=root/'outputs/全新部署'
out.mkdir(parents=True,exist_ok=True)
def files(folder):
    return [p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def archive(target,entries):
    with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
        for p,name in sorted(entries,key=lambda x:x[1]):
            i=ZipInfo(name,date_time=(2026,11,4,0,0,0)); i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16
            z.writestr(i,p.read_bytes())
def manifest(folder):
    rows={p.relative_to(folder).as_posix():digest(p) for p in sorted(files(folder)) if p.name not in ['SHA256.txt','SHA256.json']}
    (folder/'SHA256.txt').write_text(''.join(f'{h}  {n}\n' for n,h in rows.items()))
    (folder/'SHA256.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    return rows
archive(out/'Pages最终上传包.zip',[(p,p.relative_to(root/'dist').as_posix()) for p in files(root/'dist')])
with ZipFile(out/'Pages最终上传包.zip') as z:
    assert len(z.namelist())==11 and '_worker.js' in z.namelist()
    for n in z.namelist():assert z.read(n)==(root/'dist'/n).read_bytes()
folders=['src','scripts','tests','migrations','docs','tools']
source=[(p,p.relative_to(root).as_posix()) for f in folders for p in files(root/f)]
source += [(root/n,n) for n in ['README.md','package.json']]
with ZipFile(root/'outputs/第九阶段小改动二/第九阶段小改动二源码.zip') as z:
    prior={n:z.read(n) for n in z.namelist() if n.startswith(tuple(f+'/' for f in folders)) or n in ['README.md','package.json']}
    current={n:p.read_bytes() for p,n in source}
    inventory={'baseline':'第九阶段小改动二源码.zip','modified':[n for n in prior if n in current and prior[n]!=current[n]],'added':sorted(n for n in current if n not in prior),'removed':[n for n in prior if n not in current]}
    immutable=[n for n in prior if n in current and prior[n]==current[n] and n.startswith(('src/','migrations/'))]
    assert all(current[n]==data for n,data in prior.items() if n.startswith('migrations/'))
    assert current['src/server/backup.js']==prior['src/server/backup.js']
    assert current['src/server/auth.js']==prior['src/server/auth.js']
(out/'修改文件清单.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(root/'backup-dist/backup-worker.js',out/'backup-worker.js')
shutil.copyfile(out/'Pages最终上传包.zip',kit/'Pages最终上传包.zip')
shutil.copyfile(out/'backup-worker.js',kit/'backup-worker.js')
for name in ['全新部署手册.md','第九阶段小改动三交付说明.md','第九阶段小改动三查询预算.md']:
    shutil.copyfile(root/'docs'/name,out/name)
shutil.copyfile(root/'docs/全新部署手册.md',kit/'全新部署手册.md')
shutil.copyfile(root/'scripts/sql/D1限制只读检查.sql',kit/'D1限制只读检查.sql')
shutil.copyfile(root/'scripts/sql/D1限制只读检查.sql',out/'D1限制只读检查.sql')
# One authoritative deployment manual; the backup ZIP carries the same document.
archive(out/'备份Worker网页部署包.zip',[(out/'backup-worker.js','backup-worker.js'),(out/'全新部署手册.md','全新部署手册.md')])
reports={
 'stage9c-build.txt':'生产构建输出.txt','stage9c-all.txt':'源码测试结果.txt','stage9c-bundle.txt':'构建产物测试结果.txt',
 'stage9c-before-all.txt':'修复前全套测试.txt','stage9c-regression-before.txt':'修复前新增回归.txt','stage9c-audit-before.txt':'修复前大审计复现.txt','stage9c-regression.txt':'新增回归原始输出.txt',
 'stage9c-http-budget.json':'全部HTTP查询预算.json','stage9c-http-budget-bundle.json':'打包全部HTTP查询预算.json',
 'isolation-stage8-source.json':'隔离HTTP结果.json','isolation-stage8-bundle.json':'打包隔离HTTP结果.json',
}
for suffix,label in [('source.txt','独立解压源码测试.txt'),('bundle.txt','独立重建Worker测试.txt'),('build.txt','独立构建输出.txt'),('verification.json','独立重建一致性.json')]:
    name='stage9c-artifact-'+suffix
    if (root/'work/reports'/name).exists():reports[name]=label
for name,label in reports.items():shutil.copyfile(root/'work/reports'/name,out/label)
budget=json.loads((out/'全部HTTP查询预算.json').read_text())
verification=json.loads((kit/'部署资料核验.json').read_text())
verification.update({'change_scope':'D1真实限制修复与LocalD1模拟；保留ACCESS_MODE及TURNSTILE_MODE','production_pages_sha256':digest(out/'Pages最终上传包.zip'),'production_pages_files':11,'source_tests':125,'built_worker_tests':125,'original_tests_retained':116,'new_tests':9,'isolation_passed':41,'query_interfaces':len(budget['interfaces']),'query_maximum':budget['maximum'],'protected_files_unchanged':immutable,'migrations_equal_accepted':11,'backup_worker_equal_accepted':False,'backup_source_unchanged':True,'backup_release_sha256':digest(kit/'backup-worker.js'),'backup_rebuild_sha256':digest(root/'backup-dist/backup-worker.js'),'backup_rebuild_equals_release':True,'backup_deployment_required':True,'real_cloud_deployment_performed':False,'d1_simulated_limits':{'like_glob_pattern_bytes':50,'value_and_row_bytes':2000000,'binding_count':100,'sql_bytes':100000,'json_function_arguments':32},'d1_application_budgets':{'record_json':800000,'audit_before_plus_after':200000,'brand_image_data_url':260000,'manifest':256000,'legacy_raw_row':500000,'binding_value':1800000,'binding_total':1850000,'json_batch':1500000}})
verification.pop('independent_rebuild',None)
independent=root/'work/reports/stage9c-artifact-verification.json'
if independent.exists():verification['independent_rebuild']=json.loads(independent.read_text())
(kit/'部署资料核验.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(kit/'部署资料核验.json',out/'部署资料核验.json')
manifest(kit)
archive(root/'outputs/全新部署资料包.zip',[(p,p.relative_to(kit).as_posix()) for p in files(kit)])
(root/'outputs/全新部署资料包.SHA256.txt').write_text(digest(root/'outputs/全新部署资料包.zip')+'  全新部署资料包.zip\n')
source.extend((out/label,'验收结果/'+label) for label in reports.values())
source.extend((out/name,'验收结果/'+name) for name in ['部署资料核验.json','修改文件清单.json'])
archive(out/'第九阶段小改动三源码.zip',source)
rows=manifest(out)
print(json.dumps({'output':str(out),'pages_files':11,'source_files':len(source),'archives':{n:h for n,h in rows.items() if n.endswith('.zip')},'backup_sha256':digest(out/'backup-worker.js'),'deployment_kit_sha256':digest(root/'outputs/全新部署资料包.zip')},ensure_ascii=False,indent=2))
