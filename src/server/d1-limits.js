import { fail } from "./core.js";
// UTF-8 bytes, not JavaScript character count. Leave headroom for SQLite headers.
export const D1_VALUE_BUDGET = 1800000;
export const D1_RECORD_BUDGET = 800000;
export const AUDIT_PAIR_BUDGET = 200000;
export const BRAND_IMAGE_BUDGET = 260000;
export const MANIFEST_BUDGET = 256000;
export const LEGACY_ROW_BUDGET = 500000;
export const SNAPSHOT_SAFE_ASCII_PATTERN = "*[^A-Za-z0-9+/=;:.,_-]*";
export function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
export function boundedText(value, limit, label) {
  if (typeof value === "string" && byteLength(value) > limit)
    fail(413, label + "过大，请缩小内容后重试", "D1_SIZE_LIMIT");
  return value;
}
export function storedRecord(row, label = "记录") {
  boundedText(JSON.stringify(row), D1_RECORD_BUDGET, label);
  // This bound also guarantees JSON snapshot assembly fits before it executes.
  let snapshotUpper = 4096;
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== "string") {
      snapshotUpper += 32;
      continue;
    }
    const size = byteLength(value);
    // Valid JSON or a restricted ASCII alphabet cannot contain raw controls.
    let structured = /^[-A-Za-z0-9+/=;:.,_]*$/.test(value);
    if (!structured && (value.startsWith("{") || value.startsWith("["))) {
      try {
        JSON.parse(value);
        structured = true;
      } catch {}
    }
    snapshotUpper += size * (structured ? 2 : 6) + byteLength(key) + 8;
  }
  if (snapshotUpper > D1_VALUE_BUDGET)
    fail(413, label + "序列化后过大，请缩小长文本后重试", "D1_SIZE_LIMIT");
  return row;
}
export function auditChunks(pairs) {
  const chunks = [];
  let before = [],
    after = [],
    size = 4;
  for (const [a, b] of pairs) {
    const n =
      byteLength(JSON.stringify(a ?? null)) +
      byteLength(JSON.stringify(b ?? null)) +
      2;
    if (n + 4 > AUDIT_PAIR_BUDGET)
      fail(413, "单条审计变更过大，请分次修改", "D1_SIZE_LIMIT");
    if (size + n > AUDIT_PAIR_BUDGET && before.length) {
      chunks.push([JSON.stringify(before), JSON.stringify(after)]);
      before = [];
      after = [];
      size = 4;
    }
    before.push(a ?? null);
    after.push(b ?? null);
    size += n;
  }
  if (before.length || !pairs.length)
    chunks.push([JSON.stringify(before), JSON.stringify(after)]);
  return chunks;
}
export function jsonChunks(rows, max = 1500000) {
  const chunks = [];
  let part = [],
    size = 2;
  for (const row of rows) {
    const n = byteLength(JSON.stringify(row)) + 1;
    if (n + 2 > max) fail(413, "单条导入内容过大", "D1_SIZE_LIMIT");
    if (part.length && (size + n > max || part.length === 200)) {
      chunks.push(JSON.stringify(part));
      part = [];
      size = 2;
    }
    part.push(row);
    size += n;
  }
  if (part.length) chunks.push(JSON.stringify(part));
  return chunks;
}
export function checkBindings(query, params) {
  if (byteLength(query) > 100000 || params.length > 100)
    fail(503, "数据库请求超出安全预算", "D1_QUERY_LIMIT");
  let sum = 0;
  for (const p of params) {
    if (typeof p === "string") {
      boundedText(p, D1_VALUE_BUDGET, "数据内容");
      sum += byteLength(p);
    } else if (p instanceof Uint8Array) sum += p.byteLength;
    else sum += 8;
  }
  if (sum > 1850000) fail(413, "本次数据内容过大，请分批处理", "D1_SIZE_LIMIT");
}
export function assertPattern(pattern) {
  if (byteLength(pattern) > 50)
    fail(503, "数据库匹配模式超出安全预算", "D1_QUERY_LIMIT");
  return pattern;
}
