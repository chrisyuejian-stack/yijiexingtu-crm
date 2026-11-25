import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { setup, lesson, status } from "./fixtures-credit.mjs";

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
  const samples = [];
  for (const path of ["todo/summary","c2/renewals","c2/home","finance/receivable-summary","finance/report?month=2026-11"]) {
    statements.length=0;
    const start=performance.now();
    const response=await f.request("https://school.test/"+selected.t.slug+"/api/"+path,{
      headers:{Cookie:"channel_session="+selected.token},
    });
    const elapsed_ms=performance.now()-start;
    assert.equal(response.status,200,await response.clone().text());
    const plan = new Set();
    for (const {query,params} of statements)
      for (const row of db.prepare("EXPLAIN QUERY PLAN "+query).all(...params))
        if (/^((SEARCH|SCAN) (x |d |student_payments |credit_debts |s USING INDEX (payments_|p1_payments_))|SEARCH .* (p1_|transaction_|payments_|credit_debt_))/.test(row.detail))
          plan.add(row.detail);
    samples.push({path,timing:response.headers.get("server-timing"),elapsed_ms:Number(elapsed_ms.toFixed(1)),plan:[...plan]});
  }
  const counts = (table, where = "") => db.prepare("SELECT COUNT(*) n FROM "+table+" WHERE tenant_id=? "+where).get(selected.t.id).n;
  console.log(JSON.stringify({
    tenants:2,students_each:320,ledger_each:32000,payments_each:8000,
    selected_november_payments:counts("student_payments","AND paid_at>='2026-11-01' AND paid_at<'2026-12-01'"),
    selected_november_consumes:counts("package_transactions","AND date>='2026-11-01' AND date<'2026-12-01'"),
    selected_unsettled_debts:counts("credit_debts","AND remaining_units>0"),samples,
  },null,2));
} finally { f.restore(); Date.now=current; }
