import test from 'node:test';
import assert from 'node:assert/strict';
import {school,call,ok} from './fixtures-plans.mjs';
import {createV2,writeDoc} from './fixtures-v2.mjs';

const send = async (s,p) => ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}));
const link = async (s,p) => ok(await call(s,'plans/'+p.id+'/share-links','POST',{}),201);
const path = l => '/api/share/'+l.url.split('/').at(-1);
const open = (s,l) => call(s,path(l),'GET',undefined,null);
const save = async (s,p,amount) => {
  const doc=writeDoc(p);doc.modules.courses.lines[0].manual_unit_price=amount;
  return ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc}));
};

test('SHARE21 v2 重发撤销所有旧链接，新链接新价，未重发与其他方案链接不受影响',()=>school(async s=>{
  let p=await send(s,await createV2(s));
  const a=await link(s,p),b=await link(s,p),manual=await link(s,p);
  ok(await call(s,'plans/'+p.id+'/share-links/'+manual.id,'DELETE',{}));
  const invalid=await open(s,manual);assert.equal(invalid.status,404);
  const q=await send(s,await createV2(s)),unrelated=await link(s,q);
  p=await save(s,p,300);
  for(const l of [a,b,unrelated])assert.equal(ok(await open(s,l)).render_data.computed.total.amount,400);
  p=await send(s,p);
  for(const l of [a,b]){
    const response=await open(s,l);assert.equal(response.status,404);assert.deepEqual(response.body,invalid.body);
    assert.equal((await call(s,path(l)+'/media/unused','GET',undefined,null)).status,404);
    assert.equal((await call(s,path(l)+'/style-assets/unused.png','GET',undefined,null)).status,404);
  }
  assert.equal(ok(await open(s,unrelated)).render_data.computed.total.amount,400);
  assert.equal(ok(await open(s,await link(s,p))).render_data.computed.total.amount,600);
}));

test('SHARE21 失败发送不撤销链接，同价重发也撤销，失效与现有手工作废响应一致',()=>school(async s=>{
  let p=await send(s,await createV2(s));const a=await link(s,p);
  ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version-1,acknowledgements:{manual_pricing:true}}),409);
  assert.equal((await open(s,a)).status,200);
  p=await save(s,p,null);
  ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}),422);
  assert.equal((await open(s,a)).status,200);
  p=await save(s,p,200);await send(s,p);
  assert.equal((await open(s,a)).status,404);
}));

test('SHARE21 发送与生成分享并发，不能遗留有效的旧修订链接',()=>school(async s=>{
  let p=await send(s,await createV2(s));const original=await link(s,p);p=await save(s,p,300);
  const [sent,created]=await Promise.all([
    call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}),
    call(s,'plans/'+p.id+'/share-links','POST',{}),
  ]);
  ok(sent);assert.ok([201,409].includes(created.status));
  assert.equal((await open(s,original)).status,404);
  if(created.status===201){const res=await open(s,created.body);assert.ok([200,404].includes(res.status));if(res.status===200)assert.equal(res.body.render_data.computed.total.amount,600);}
  const fresh=await link(s,sent.body);assert.equal(ok(await open(s,fresh)).render_data.computed.total.amount,600);
}));

test('SHARE21 发送事务后段失败时，修订发布和链接撤销一并回滚',()=>school(async s=>{
  let p=await send(s,await createV2(s));const oldSent=p.sent_revision_id,a=await link(s,p);p=await save(s,p,300);
  s.f.db.raw.exec("CREATE TRIGGER share21_fail_send BEFORE INSERT ON audit_log WHEN NEW.module='plans' AND NEW.action='send' BEGIN SELECT RAISE(ABORT,'share21 injected audit failure'); END");
  ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}),500);
  const unchanged=ok(await call(s,'plans/'+p.id));assert.equal(unchanged.version,p.version);assert.equal(unchanged.sent_revision_id,oldSent);
  assert.equal(ok(await open(s,a)).render_data.computed.total.amount,400);
  s.f.db.raw.exec('DROP TRIGGER share21_fail_send');
  const sent=await send(s,p);assert.equal((await open(s,a)).status,404);assert.equal(ok(await open(s,await link(s,sent))).render_data.computed.total.amount,600);
}));
