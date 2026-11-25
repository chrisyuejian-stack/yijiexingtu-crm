// Generate read-only, individually executable Cloudflare D1 Console checks.
import { writeFile } from "node:fs/promises";
import { backupTables } from "../src/server/backup-model.js";
import {
  D1_VALUE_BUDGET,
  BRAND_IMAGE_BUDGET,
  SNAPSHOT_SAFE_ASCII_PATTERN,
  assertPattern,
} from "../src/server/d1-limits.js";
const pattern = assertPattern(SNAPSHOT_SAFE_ASCII_PATTERN);
let text =
  "-- 只读；在 D1 Console 每次执行一条完整语句。不会读取/输出图片或联系人内容。\n-- 每行 over_budget=0 才符合本版备份预算；非0先导出备份、人工核对，不自动截断或改写。\n";
for (const [table, spec] of Object.entries(backupTables)) {
  const terms = spec.columns.map((k) => {
    const c = '"' + k + '"';
    return `CASE WHEN typeof(${c})='text' THEN CASE WHEN json_valid(${c}) OR ${c} NOT GLOB '${pattern}' THEN 2 ELSE 6 END*length(CAST(${c} AS BLOB)) ELSE 32 END`;
  });
  text += `SELECT '${table}' AS table_name, COUNT(*) AS over_budget FROM ${table} WHERE (4096+${terms.join("+")})>${D1_VALUE_BUDGET};\n`;
}
text +=
  "-- 旧品牌图片：定位超过新上限的字段；只返回机构ID及字节数。由超管重新上传压缩图；不在SQL中自动压缩。\nSELECT tenant_id,length(CAST(logo AS BLOB)) logo_bytes,length(CAST(login_bg AS BLOB)) login_bg_bytes,length(CAST(consultant_qr AS BLOB)) qr_bytes FROM tenant_branding WHERE length(CAST(logo AS BLOB))>260000 OR length(CAST(login_bg AS BLOB))>260000 OR length(CAST(consultant_qr AS BLOB))>260000;\n";
text = text.replaceAll(">260000", ">" + BRAND_IMAGE_BUDGET);
await writeFile("scripts/sql/D1限制只读检查.sql", text);
console.log(
  JSON.stringify({
    tables: Object.keys(backupTables).length,
    pattern_bytes: new TextEncoder().encode(pattern).length,
    statements: Object.keys(backupTables).length + 1,
  }),
);
