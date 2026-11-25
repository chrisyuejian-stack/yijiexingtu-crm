import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';
import { schoolFixture } from './fixtures-school.mjs';
import { sha } from '../src/server/core.js';

test('会话失效的已知机构网页回登录；API仍401，未知路径和主机仍404，有效会话可用',async()=>{
  const f=await fixture();
  try {
    const s=await schoolFixture(f,'session-nav');
    const url=path=>`https://school.test/${s.t.slug}/${path}`;
    const check=async(path,init={})=>{
      const r=await f.request(url(path),init);
      assert.equal(r.status,302);
      assert.equal(r.headers.get('location'),`/${s.t.slug}/login`);
      assert.match(r.headers.get('set-cookie'),/channel_session=;.*HttpOnly; Secure; SameSite=Strict; Max-Age=0/);
      assert.match(r.headers.get('cache-control'),/no-store/);
      return r;
    };
    await check('app/');
    await check('app/profile',{method:'HEAD'});
    await check('app/schedule',{headers:{Cookie:'channel_session=invalid'}});
    const valid=await f.request(url('app/'),{headers:{Cookie:`channel_session=${s.token}`}});
    assert.equal(valid.status,200);assert.match(valid.headers.get('content-type'),/text\/html/);
    f.db.raw.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1,await sha(s.token));
    await check('app/',{headers:{Cookie:`channel_session=${s.token}`}});
    const api=await f.request(url('api/me'),{headers:{Cookie:`channel_session=${s.token}`}});
    assert.equal(api.status,401);assert.equal((await api.json()).code,'SESSION_INVALID');
    assert.equal(api.headers.get('location'),null);
    assert.equal((await f.request(url('app/not-a-route'))).status,404);
    assert.equal((await f.request('https://school.test/not-a-tenant/app/')).status,404);
    assert.equal((await f.request(`https://wrong.test/${s.t.slug}/app/`)).status,404);
  }finally{f.restore();}
});
