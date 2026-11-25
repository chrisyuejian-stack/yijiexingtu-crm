import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './support.mjs';
import {setup} from './fixtures-credit.mjs';
import {school,call,ok,accountToken} from './fixtures-plans.mjs';
import {png} from './fixtures-platform.mjs';
import {upload,storageLimit,gallery,ops,httpExamples} from './fixtures-v041.mjs';
const encoded=png.toString('base64'),size=encoded.length;
async function oldImage(s,id='legacy',body=encoded){const key='old/'+s.t.id+'/'+id;await s.r.settingsGalleryCreate({id,r2_key:key,mime:'image/png',width:1,height:1,tags:[],consent:false},s.user);if(body!==null)await s.f.env.CHANNEL_MEDIA.put(key,body);return key}

test('V041 G4 0027仅加两列，旧表原行和版本不变，原图按对象大小回填',async()=>{
 const f=await fixture({migrateStorage:false});try{const s=await setup(f,1,'migration041');s.f=f;const db=f.db.raw,key='old/migration';db.prepare('INSERT INTO gallery_images(tenant_id,id,r2_key,mime,width,height,tags_json,consent,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(s.t.id,'old_image',key,'image/png',1,1,'[]',0,1,s.user.id,1,s.user.id);await f.env.CHANNEL_MEDIA.put(key,encoded);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),before=names.map(n=>({n,cols:db.prepare('PRAGMA table_info('+n+')').all().map(x=>x.name),rows:db.prepare('SELECT * FROM '+n).all().map(x=>JSON.stringify(x))}));db.exec(await readFile('migrations/0027_gallery_storage.sql','utf8'));for(const x of before)assert.deepEqual(db.prepare('SELECT '+x.cols.join(',')+' FROM '+x.n).all().map(x=>JSON.stringify(x)),x.rows,x.n);assert.equal(db.prepare('SELECT bytes FROM gallery_images').get().bytes,0);
 const imageBefore=db.prepare('SELECT * FROM gallery_images').get(),v=ok(await gallery(s));assert.equal(v.storage.used,size);assert.equal(v.storage.limit,524288000);assert.equal(v.storage.pending,0);assert.deepEqual({...db.prepare('SELECT id,version,updated_at,updated_by FROM gallery_images').get()},{id:imageBefore.id,version:imageBefore.version,updated_at:imageBefore.updated_at,updated_by:imageBefore.updated_by});assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.restore()}
});

test('V041 G4 默认500MiB，上传按R2实际Base64字节计量，列表携带storage',()=>school(async s=>{
 const empty=ok(await gallery(s));assert.equal(empty.storage.used,0);assert.equal(empty.storage.limit,500*1024*1024);const img=ok(await upload(s,png),201);const row=await s.r.settingsGallery(img.id);assert.equal(row.bytes,size);assert.equal(s.f.env.CHANNEL_MEDIA.objects.get(row.r2_key),encoded);const list=ok(await gallery(s));assert.equal(list.storage.used,size);assert.equal(list.storage.complete,true);assert.equal(list.storage.pending,0);
}));

test('V041 G4 容量满返回413 used/limit，未写R2或元数据，删除真释放后可再上传',()=>school(async s=>{
 ok(await storageLimit(s,size));const a=ok(await upload(s,png),201);const oldCount=s.f.env.CHANNEL_MEDIA.objects.size;const blocked=ok(await upload(s,png),413);assert.equal(blocked.error,'storage_full');assert.equal(blocked.details.used,size);assert.equal(blocked.details.limit,size);assert.equal(s.f.env.CHANNEL_MEDIA.objects.size,oldCount);
 ok(await call(s,'gallery/'+a.id,'DELETE',{version:a.version}));assert.equal(ok(await gallery(s)).storage.used,0);ok(await upload(s,png),201);assert.equal(ok(await gallery(s)).storage.used,size);
}));

test('V041 G4 只剩一张图容量时并发只成功一张，失败对象清理且不超额',()=>school(async s=>{
 ok(await storageLimit(s,size));const a=await Promise.all([upload(s,png),upload(s,png)]);assert.deepEqual(a.map(x=>x.status).sort(),[201,413]);assert.equal(s.f.env.CHANNEL_MEDIA.objects.size,1);assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM gallery_images WHERE tenant_id=? AND deleted_at IS NULL').get(s.t.id).n,1);assert.equal(ok(await gallery(s)).storage.used,size);
}));

test('V041 G4 历史引用图只隐藏仍计容量，保护旧文档且不能靠隐藏绕限额',()=>school(async s=>{
 ok(await storageLimit(s,size));const img=ok(await upload(s,png),201);await s.r.settingsAssetReference(img.id,'test_history','old_doc');const v=ok(await call(s,'gallery/'+img.id,'DELETE',{version:img.version}));assert.equal(v.hidden,true);const list=ok(await gallery(s));assert.equal(list.items.length,0);assert.equal(list.storage.used,size);assert.ok(await s.r.settingsGallery(img.id));assert.equal(ok(await upload(s,png),413).error,'storage_full');
}));

test('V041 G4 容量和回填限本机构，外机构图库404，不读取其他对象',()=>school(async s=>{
 const b=await setup(s.f,1,'storage-b');b.f=s.f;const aKey=await oldImage(s,'a_image'),bKey=await oldImage(b,'b_image');const get=s.f.env.CHANNEL_MEDIA.get.bind(s.f.env.CHANNEL_MEDIA),seen=[];s.f.env.CHANNEL_MEDIA.get=async key=>{seen.push(key);return get(key)};
 try{assert.equal(ok(await gallery(s)).storage.used,size);assert.deepEqual(seen,[aKey]);assert.ok(!seen.includes(bKey));assert.equal((await b.r.settingsGallery('b_image')).bytes,0);ok(await call(s,'gallery/b_image/file'),404)}finally{s.f.env.CHANNEL_MEDIA.get=get}
}));

test('V041 G4 缺失旧对象标NULL，网络错误保留待统计；回填不改其他业务列',()=>school(async s=>{
 await oldImage(s,'missing',null);let v=ok(await gallery(s));assert.equal(v.storage.used,0);assert.equal(v.storage.missing,1);assert.equal((await s.r.settingsGallery('missing')).bytes,null);const key=await oldImage(s,'network');const before=await s.r.settingsGallery('network'),get=s.f.env.CHANNEL_MEDIA.get.bind(s.f.env.CHANNEL_MEDIA);s.f.env.CHANNEL_MEDIA.get=async k=>{if(k===key)throw Error('local R2 unavailable');return get(k)};
 try{assert.equal(ok(await gallery(s),503).error,'storage_unavailable');assert.equal((await s.r.settingsGallery('network')).bytes,0)}finally{s.f.env.CHANNEL_MEDIA.get=get}
 v=ok(await gallery(s));assert.equal(v.storage.used,size);const after=await s.r.settingsGallery('network');delete before.bytes;delete after.bytes;assert.deepEqual(after,before);
}));

test('V041 G4 回填每次最多20对象，未完成时禁止上传避免低估',()=>school(async s=>{
 for(let i=0;i<45;i++)await oldImage(s,'batch_'+String(i).padStart(2,'0'));
 const first=ok(await gallery(s));assert.equal(first.storage.pending,25);assert.equal(first.storage.complete,false);const r=ok(await upload(s,png),503);assert.equal(r.error,'storage_pending');assert.equal(r.details.storage.pending,5);assert.equal(s.f.env.CHANNEL_MEDIA.objects.size,45);const last=ok(await gallery(s));assert.equal(last.storage.pending,0);assert.equal(last.storage.used,45*size);ok(await upload(s,png),201);
}));

test('V041 G4 平台owner调整限额/版本冲突/回填，员工无权操作',()=>school(async s=>{
 let st=ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage'));const prior=st.version;st=ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage','PUT',{version:prior,limit:0}));assert.equal(st.limit,0);const e=ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage','PUT',{version:prior,limit:size}),409);assert.equal(e.error,'version_conflict');assert.equal(e.details.latest.limit,0);ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage','PUT',{version:st.version,limit:-1}),422);ok(await ops(s,'tenants/missing/gallery-storage'),404);ok(await call(s,'/api/ops/tenants/'+s.t.id+'/gallery-storage'),404);
 await oldImage(s);const rec=ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage/recount','POST',{}));assert.equal(rec.used,size);assert.equal(rec.pending,0);assert.equal(rec.limit,0);assert.ok(s.f.db.raw.prepare("SELECT id FROM platform_audit WHERE action='gallery_storage_limit'").get());
}));

test('V041 G4 R2删除失败仍计费，重试删除成功才释放容量',()=>school(async s=>{
 const img=ok(await upload(s,png),201),del=s.f.env.CHANNEL_MEDIA.delete.bind(s.f.env.CHANNEL_MEDIA);s.f.env.CHANNEL_MEDIA.delete=async()=>{throw Error('local R2 failure')};try{ok(await call(s,'gallery/'+img.id,'DELETE',{version:img.version}),500);assert.equal((await s.r.galleryStorage()).used,size)}finally{s.f.env.CHANNEL_MEDIA.delete=del}
 ok(await call(s,'gallery/'+img.id,'DELETE',{version:img.version}));assert.equal((await s.r.galleryStorage()).used,0);assert.equal(s.f.env.CHANNEL_MEDIA.objects.size,0);
}));

test('V041 G4 SQL故障清理新R2对象，提交回执丢失保持已提交对象',()=>school(async s=>{
 s.f.db.raw.exec("CREATE TRIGGER fail_gallery041 BEFORE INSERT ON gallery_images BEGIN SELECT RAISE(ABORT,'local SQL fault'); END");ok(await upload(s,png),500);assert.equal(s.f.env.CHANNEL_MEDIA.objects.size,0);assert.equal((await s.r.galleryStorage()).used,0);s.f.db.raw.exec('DROP TRIGGER fail_gallery041');
 const batch=s.f.db.batch.bind(s.f.db);let lost=false;s.f.db.batch=async ops=>{const result=await batch(ops);if(!lost&&ops.some(x=>x.query.startsWith('INSERT INTO gallery_images'))){lost=true;throw Error('local commit ACK lost')}return result};try{const item=ok(await upload(s,png),201);assert.ok(s.f.env.CHANNEL_MEDIA.objects.has((await s.r.settingsGallery(item.id)).r2_key));assert.equal((await s.r.galleryStorage()).used,size)}finally{s.f.db.batch=batch}
}));

test('V041 G4 R2 head路径用实际size，图库bytes和机构上限进入加密备份快照',()=>school(async s=>{
 const key=await oldImage(s);s.f.env.CHANNEL_MEDIA.head=async k=>k===key?{size:12345}:null;assert.equal(ok(await gallery(s)).storage.used,12345);ok(await storageLimit(s,22222));const {startBackup}=await import('../src/server/backup.js');await startBackup(s.f.env,Date.now());const rows=s.f.db.raw.prepare("SELECT table_name,row_json FROM backup_snapshot_rows WHERE table_name IN('tenants','gallery_images')").all();assert.equal(JSON.parse(rows.find(x=>x.table_name==='gallery_images').row_json).bytes,12345);assert.equal(JSON.parse(rows.find(x=>x.table_name==='tenants'&&JSON.parse(x.row_json).id===s.t.id).row_json).gallery_storage_limit,22222);
}));

after(async()=>{await mkdir('work/v041',{recursive:true});await writeFile('work/v041/http-storage-'+(process.env.TEST_BUNDLE==='1'?'bundle':'source')+'.json',JSON.stringify({local_only:true,examples:httpExamples},null,2)+'\n')});
