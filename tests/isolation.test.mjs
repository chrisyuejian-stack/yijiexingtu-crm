import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { runIsolation } from "../scripts/isolation.mjs";
test("第八阶段 HTTP 隔离验收（本地 SQLite / D1 接口适配）", async () => {
  const f = await fixture();
  try {
    const report = await runIsolation({
      request: f.request,
      baseUrl: "https://school.test",
      consoleUrl: "https://console.school.test",
      adminCookie: f.adminCookie,
      accessJwt: f.access,
      turnstileToken: "fixture-valid",
    });
    report.build =
      process.env.TEST_BUNDLE === "1"
        ? "dist/_worker.js"
        : "src/server/worker.js";
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/isolation-local.json",
      JSON.stringify(report, null, 2),
    );
    await writeFile(
      "work/reports/" +
        (process.env.TEST_BUNDLE === "1"
          ? "isolation-stage8-bundle.json"
          : "isolation-stage8-source.json"),
      JSON.stringify(report, null, 2),
    );
    for (const row of report.results)
      console.log(row.status, row.name, row.detail || "");
    assert.equal(report.summary.not_implemented, 0);
    assert.equal(
      report.summary.failed,
      0,
      JSON.stringify(report.results.filter((x) => x.status === "FAIL")),
    );
  } finally {
    f.restore();
  }
});
