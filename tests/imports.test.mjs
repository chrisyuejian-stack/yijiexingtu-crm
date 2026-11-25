import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { setup, request, accountToken } from "./fixtures-credit.mjs";
import { workbook, readWorkbook } from "../src/server/xlsx.js";
import { IMPORT_HEADERS } from "../src/server/imports.js";
const file = (kind, rows) =>
  Buffer.from(workbook([IMPORT_HEADERS[kind], ...rows])).toString("base64");
const ok = (r, status = 200) => {
  assert.equal(r.status, status, r.text);
  assert.ok(r.queries <= 40);
  return r.body;
};
test("第六阶段：Excel四步校验、同名不自动覆盖、仅合法行提交、200行批次幂等、金额不可注入和跨机构凭证拒绝", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      b = { ...(await setup(f, 1, "b")), f };
    const payload = file("students", [
      ["学员0", "13900000001", "", "", "", "", "", ""],
      [
        "新学员",
        "13900000002",
        "",
        "",
        "",
        "",
        "",
        "<img src=x onerror=alert(1)>",
      ],
      ["错误行", "123"],
    ]);
    const preview = ok(
      await request(s, "imports/preview?kind=students", "POST", {
        file: payload,
      }),
    );
    assert.equal(preview.rows[0].status, "duplicate");
    assert.equal(preview.rows[1].status, "valid");
    assert.equal(preview.rows[2].status, "invalid");
    assert.ok(!JSON.stringify(preview).includes("13900000002"));
    const rows = [
      { token: preview.rows[0].token, action: "skip" },
      { token: preview.rows[1].token, action: "new" },
    ];
    const data = { operation_id: "import_students_001", rows };
    const result = ok(
      await request(s, "imports/commit?kind=students", "POST", data),
    );
    assert.equal(result.imported, 1);
    assert.deepEqual(
      ok(await request(s, "imports/commit?kind=students", "POST", data)),
      result,
    );
    ok(
      await request(b, "imports/commit?kind=students", "POST", {
        ...data,
        operation_id: "foreign_import_001",
      }),
      400,
    );
    const acad = await accountToken(s, ["academic"]);
    ok(
      await request(
        s,
        "imports/preview?kind=teachers",
        "POST",
        { file: file("teachers", [["新教师", "13900000003", "钢琴"]]) },
        acad.token,
      ),
      403,
    );
    const balance = ok(
      await request(
        s,
        "imports/preview?kind=balances",
        "POST",
        { file: file("balances", [["新学员", "班课", "5.25", "2026-12-31"]]) },
        acad.token,
      ),
    );
    const imported = ok(
      await request(
        s,
        "imports/commit?kind=balances",
        "POST",
        {
          operation_id: "import_balances_001",
          rows: [
            {
              action: "new",
              token: balance.rows[0].token,
              amount: 999999,
              unit_price: 99999,
            },
          ],
        },
        acad.token,
      ),
    );
    assert.equal(imported.imported, 1);
    const db = f.db.raw
      .prepare(
        "SELECT unit_price,amount,units_total FROM packages WHERE tenant_id=?",
      )
      .get(s.t.id);
    assert.equal(db.unit_price, null);
    assert.equal(db.amount, null);
    assert.equal(db.units_total, 5.25);
  } finally {
    f.restore();
  }
});

test("第六阶段：普通DEFLATE Excel、数值课时/日期兼容；公式、压缩炸弹、错误手机和超精度课时拒绝", async () => {
  const { deflateRawSync, crc32 } = await import("node:zlib");
  const compressed = (source, replace) => {
    const bytes = Buffer.from(source),
      parts = [],
      dirs = [];
    let at = 0,
      offset = 0,
      n = 0;
    while (bytes.readUInt32LE(at) === 0x04034b50) {
      const nameLen = bytes.readUInt16LE(at + 26),
        extra = bytes.readUInt16LE(at + 28),
        size = bytes.readUInt32LE(at + 18),
        name = bytes.subarray(at + 30, at + 30 + nameLen),
        start = at + 30 + nameLen + extra;
      let raw = bytes.subarray(start, start + size);
      if (replace && name.toString() === "xl/worksheets/sheet1.xml")
        raw = Buffer.from(replace(raw.toString()));
      const data = deflateRawSync(raw),
        local = Buffer.alloc(30),
        dir = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc32(raw), 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      dir.writeUInt32LE(0x02014b50);
      dir.writeUInt16LE(20, 4);
      dir.writeUInt16LE(20, 6);
      dir.writeUInt16LE(8, 10);
      dir.writeUInt32LE(crc32(raw), 16);
      dir.writeUInt32LE(data.length, 20);
      dir.writeUInt32LE(raw.length, 24);
      dir.writeUInt16LE(name.length, 28);
      dir.writeUInt32LE(offset, 42);
      parts.push(local, name, data);
      dirs.push(dir, name);
      offset += 30 + name.length + data.length;
      at = start + size;
      n++;
    }
    const central = Buffer.concat(dirs),
      end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(n, 8);
    end.writeUInt16LE(n, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, central, end]);
  };
  const stored = workbook([
      IMPORT_HEADERS.balances,
      ["学员0", "班课", 5.25, 46386],
    ]),
    file = compressed(stored);
  const read = await readWorkbook(new Uint8Array(file));
  assert.equal(read[0].values["剩余课时"], "5.25");
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    const p = ok(
      await request(s, "imports/preview?kind=balances", "POST", {
        file: file.toString("base64"),
      }),
    );
    assert.equal(p.rows[0].status, "valid");
    ok(
      await request(s, "imports/commit?kind=balances", "POST", {
        operation_id: "excel-numeric-dates",
        rows: [{ token: p.rows[0].token, action: "new" }],
      }),
    );
    assert.match(
      f.db.raw
        .prepare("SELECT valid_to FROM packages WHERE tenant_id=?")
        .get(s.t.id).valid_to,
      /^2026-12-/,
    );
    const formula = compressed(stored, (x) =>
      x.replace("<v>5.25</v>", "<f>2+2</f><v>4</v>"),
    );
    ok(
      await request(s, "imports/preview?kind=balances", "POST", {
        file: formula.toString("base64"),
      }),
      400,
    );
    const x = ok(
      await request(s, "imports/preview?kind=balances", "POST", {
        file: Buffer.from(
          workbook([
            IMPORT_HEADERS.balances,
            ["学员0", "班课", "0.0001", "2026-12-31"],
          ]),
        ).toString("base64"),
      }),
    );
    assert.equal(x.rows[0].status, "invalid");
    const bomb = Buffer.from(file);
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(999999999, central + 24);
    ok(
      await request(s, "imports/preview?kind=balances", "POST", {
        file: bomb.toString("base64"),
      }),
      400,
    );
  } finally {
    f.restore();
  }
});
