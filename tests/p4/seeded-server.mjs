// Local development adapter only. No imports from production code into this file.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {createScenario: originalScenario,SCENARIO_NOW}=await import(pathToFileURL(process.env.P4_BASELINE+'/scripts/e2e/scenario.mjs'));
async function createScenario(kind='attendance') {
 const s=await originalScenario(kind),m=s.manifest;
 async function call(path,role='supervisor',method='GET',data) {
  const res=await s.f.request('http://localhost/'+m.slug+'/api/'+path,{method,headers:{Origin:'http://localhost',Cookie:'channel_session='+s.tokens[role],'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify({operation_id:crypto.randomUUID(),...data})})});
  const text=await res.text();assert.ok(res.status<300,path+': '+text);return JSON.parse(text);
 }
 if(['attendance','makeup'].includes(kind)) {
  const review=await call('lessons/'+m.lesson+'/review','teacher');
  await call('lessons/'+m.lesson+'/review','teacher','POST',{kind:'attendance',previous_id:null,comment_fingerprint:review.comment_fingerprint,public_text:'本地请求预算种子',homework:'',people:review.participants.map(p=>({participant_id:p.id,student_id:p.student_id,attendance:kind==='makeup'?'student_leave':'attended',comment:''}))});
  if(kind==='makeup') {
   const latest=await call('lessons/'+m.lesson+'/review','teacher');
   await call('submissions/'+latest.submission.id+'/confirm','academic','POST',{version:latest.submission.version});
  }
 }
 if(kind==='scheduling') {
  await call('data/schedule_templates','supervisor','POST',{teacher_id:m.teacher,course_type_id:m.courseId,location_id:m.room,duration:45,units:1,weekday:5,start_time:'15:00',date_from:'2026-11-01',date_to:'2026-12-31'});
  await call('credits/payments','supervisor','POST',{kind:'tuition',student_id:m.studentIds[0],amount:100,paid_at:'2026-11-12',allocations:[]});
 }
 s.f.db.raw.exec('DELETE FROM security_limits');return s;
}

const RealDate = Date;
let fixed = RealDate.parse(SCENARIO_NOW);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
};
const key = process.env.E2E_CONTROL_KEY;
if (!key || key.length < 32) throw Error('E2E_CONTROL_KEY must be provided by the local test runner');
let current = await createScenario();
const authorized = req => {
  const supplied = Buffer.from(String(req.headers['x-e2e-key'] || ''));
  const expected = Buffer.from(key);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
let busy = false;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/__e2e/')) {
      if (url.pathname === '/__e2e/health' && req.method === 'GET') return json(res, 200, { ready: true });
      if (!authorized(req)) return json(res, 403, { error: 'test controller required' });
      if (url.pathname === '/__e2e/reset' && req.method === 'POST') {
        const kind = url.searchParams.get('kind') || 'attendance';
        if (!['attendance', 'makeup', 'scheduling', 'payments', 'balance', 'concurrency', 'settlement', 'reversal-used', 'authentication'].includes(kind)) return json(res, 400, { error: 'unknown scenario' });
        if (busy) return json(res, 409, { error: 'reset already running' });
        busy = true;
        try { current.f.restore(); fixed = RealDate.parse(SCENARIO_NOW); current = await createScenario(kind); }
        finally { busy = false; }
        return json(res, 200, current.manifest);
      }
      if (url.pathname === '/__e2e/clock' && req.method === 'POST') {
        const at = RealDate.parse(url.searchParams.get('at') || '');
        const anchor = RealDate.parse(SCENARIO_NOW);
        if (!Number.isFinite(at) || at < fixed || at > anchor + 7 * 86400000)
          return json(res, 400, { error: 'clock must advance within seven scenario days' });
        fixed = at;
        current.manifest.now = new Date().toISOString();
        // Renew local fake sessions; business records are never rewritten by the clock.
        await current.renewSessions();
        return json(res, 200, { now: current.manifest.now });
      }
      if (url.pathname === '/__e2e/session' && req.method === 'POST') {
        const token = current.tokens[url.searchParams.get('role')];
        if (!token) return json(res, 400, { error: 'unknown role' });
        return json(res, 200, { ok: true }, { 'set-cookie': `channel_session=${token}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (url.pathname === '/__e2e/state' && req.method === 'GET') return json(res, 200, await current.state());
      return json(res, 404, { error: 'unknown test control' });
    }
    if (busy) return json(res, 503, { error: 'test reset in progress' });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = { ...req.headers, host: 'localhost' };
    if (headers.origin) headers.origin = 'http://localhost';
    // Preserve each browser's real session cookie; do not select the role here.
    const response = await current.f.request(`http://localhost${req.url}`, {
      method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const outHeaders = Object.fromEntries(response.headers);
    if (response.headers.getSetCookie().length) outHeaders['set-cookie'] = response.headers.getSetCookie();
    res.writeHead(response.status, outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'local test adapter failed' });
  }
});
server.listen(Number(process.env.E2E_PORT || 4380), '127.0.0.1', () => console.log('E2E server ready (loopback, disposable database)'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => {
  current.f.restore(); globalThis.Date = RealDate; process.exit();
}));
