import assert from "node:assert/strict";
import { fixture } from "../support.mjs";
import { pathToFileURL } from "node:url";
const baselineWorker=(await import(pathToFileURL(process.env.P4_BASELINE+"/src/server/worker.js"))).default;
import candidateWorker from "../../src/server/worker.js";
import { writeFile } from "node:fs/promises";
import { setup, lesson, status } from "../fixtures-credit.mjs";

const current = Date.now, at = Date.parse("2026-11-10T12:00:00+08:00");
Date.now = () => at;
const f = await fixture();
try {
  const db = f.db.raw, selected = { ...await setup(f, 30, "p1-plan"), f };
  const other = { ...await setup(f, 1, "p1-plan-other"), f };
  // Preserve realistic references, with precisely 320 students and 32,000
  // ledger rows in each tenant. Ten of 100 entries per pack fall in November.
  const debtLesson = await lesson(selected, "2026-11-09T09:00");
  assert.equal((await status(selected, debtLesson, "completed")).status, 200);
  const addStudent = db.prepare(
    "INSERT INTO students(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,0,'sample',0,'sample')",
  );
  const addPack = db.prepare(
    "INSERT INTO packages(tenant_id,id,student_id,course_type_id,unit_price,amount,units_total,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,10000,1000000,100,0,'sample',0,'sample')",
  );
  const addTxn = db.prepare(
    "INSERT INTO package_transactions(tenant_id,id,package_id,student_id,delta,type,date,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,0,'sample',0,'sample')",
  );
  const addPayment = db.prepare(
    "INSERT INTO student_payments(tenant_id,id,student_id,package_id,amount,paid_at,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,100,?,0,'sample',0,'sample')",
  );
  db.exec("BEGIN");
  for (const school of [selected, other]) {
    for (let i = 0; i < 320; i++) {
      const tid = school.t.id;
      const sid = school.students[i] || "sample-student-" + i, pkg = "sample-pack-" + i;
      if (!school.students[i]) addStudent.run(tid,sid,"样本学员"+i);
      addPack.run(tid,pkg,sid,school.type);
      for (let j = 0; j < 100; j++) {
        const date = j < 90 ? "2026-10-10" : "2026-11-09";
        addTxn.run(tid,"sample-txn-"+i+"-"+j,pkg,sid,j===0?100:-1,j===0?"purchase":"consume",date);
        if (j % 4 === 0) addPayment.run(tid,"sample-payment-"+i+"-"+j,sid,pkg,date);
      }
    }
  }
  db.exec("COMMIT; ANALYZE;");
  const statements = [], originalBatch = f.db.batch.bind(f.db);
  const originalPrepare = f.db.prepare.bind(f.db);
  f.db.prepare = (query) => {
    const stmt = originalPrepare(query), bind = stmt.bind.bind(stmt);
    stmt.bind = (...params) => {
      if (/^\s*(WITH|SELECT)/i.test(query) && /package_transactions|credit_debts|student_payments/.test(query))
        statements.push({ query, params });
      return bind(...params);
    };
    return stmt;
  };
  f.db.batch = originalBatch;
  const samples = [], legacyTotals={};
  for (const path of ["c2/students?status=active","c2/students?status=active&balance=zero","c2/students?status=active&balance=low","c2/students?offset=9999","c2/students/"+selected.students[0]]) {
    let expected;
    for (const [build, worker] of [["fifth",baselineWorker],["p4",candidateWorker]]) {
      const times=[];let timing,body,queries,plans=[];
      for(let repeat=0;repeat<7;repeat++){
        statements.length=0;
        const start=performance.now();
        const response=await f.db.measure(()=>worker.fetch(new Request("https://school.test/"+selected.t.slug+"/api/"+path,{headers:{Cookie:"channel_session="+selected.token}}),f.env));
        body=await response.json();
        times.push(performance.now()-start);timing=response.headers.get("server-timing");queries=Number(response.headers.get("x-test-d1-queries"));
        assert.equal(response.status,200,JSON.stringify(body));
        if(repeat===0)plans=statements.map(({query,params})=>({query,plan:db.prepare("EXPLAIN QUERY PLAN "+query).all(...params)}));
      }
      if(build==="fifth") {expected=body;if(path==="c2/students?status=active")legacyTotals.active=body.total;if(path.includes("balance=zero"))legacyTotals.zero=body.total;if(path.includes("balance=low"))legacyTotals.low=body.total;}else assert.deepEqual(body,expected,path);
      times.sort((a,b)=>a-b);
      samples.push({path,build,d1:queries,median_ms:Number(times[3].toFixed(2)),min_ms:Number(times[0].toFixed(2)),max_ms:Number(times[6].toFixed(2)),timing,plans});
    }
  }
  for(const state of ["paused","archived"]) {
    const response=await baselineWorker.fetch(new Request("https://school.test/"+selected.t.slug+"/api/c2/students?status="+state,{headers:{Cookie:"channel_session="+selected.token}}),f.env);
    assert.equal(response.status,200);legacyTotals[state]=(await response.json()).total;
  }
  const countsResponse=await candidateWorker.fetch(new Request("https://school.test/"+selected.t.slug+"/api/c2/students/counts",{headers:{Cookie:"channel_session="+selected.token}}),f.env);
  assert.equal(countsResponse.status,200);const aggregateCounts=await countsResponse.json();assert.deepEqual(aggregateCounts,legacyTotals);
  const actualCounts=[selected,other].map(school=>Object.fromEntries(["students","package_transactions","student_payments"].map(table=>[table,db.prepare("SELECT COUNT(*) n FROM "+table+" WHERE tenant_id=?").get(school.t.id).n])));
  await writeFile("docs/p4/大样本SQL对照.json",JSON.stringify({tenants:2,actualCounts,runs:7,parity:true,aggregateCounts,samples},null,2));
  const counts = (table, where = "") => db.prepare("SELECT COUNT(*) n FROM "+table+" WHERE tenant_id=? "+where).get(selected.t.id).n;
  console.log(JSON.stringify(samples.map(({path,build,d1,median_ms,min_ms,max_ms})=>({path,build,d1,median_ms,min_ms,max_ms})),null,2));
} finally { f.restore(); Date.now=current; }
