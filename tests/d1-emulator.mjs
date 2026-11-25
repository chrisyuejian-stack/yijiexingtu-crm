import { DatabaseSync } from "node:sqlite";
export const byteSize = (value) =>
  typeof value === "string"
    ? Buffer.byteLength(value)
    : value instanceof Uint8Array
      ? value.byteLength
      : 8;
export function validateD1(sql, params = []) {
  if (Buffer.byteLength(sql) > 100000) throw Error("D1_SQL_TOO_LONG");
  const stack = [];
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (quoted && sql[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === "(")
      stack.push({
        name: sql
          .slice(0, i)
          .match(/([a-z_]+)\s*$/i)?.[1]
          ?.toLowerCase(),
        count: 1,
      });
    else if (c === "," && stack.length) stack.at(-1).count++;
    else if (c === ")" && stack.length) {
      const f = stack.pop();
      if (
        ["json_object", "json_set", "json_array", "coalesce"].includes(
          f.name,
        ) &&
        f.count > 32
      )
        throw Error("D1_TOO_MANY_FUNCTION_ARGUMENTS");
    }
  }
  if (params.length > 100) throw Error("D1_TOO_MANY_PARAMETERS");
  if (params.some((x) => byteSize(x) > 2000000))
    throw Error("D1_VALUE_TOO_BIG");
}
export function emulateD1(raw) {
  const native = new DatabaseSync(":memory:");
  for (const op of ["like", "glob"])
    raw.function(op, { varargs: true }, (...args) => {
      if (args[0] !== null && byteSize(args[0]) > 50)
        throw Error("D1_PATTERN_TOO_COMPLEX");
      return native
        .prepare(
          op === "glob"
            ? "SELECT ? GLOB ? AS value"
            : args.length === 3
              ? "SELECT ? LIKE ? ESCAPE ? AS value"
              : "SELECT ? LIKE ? AS value",
        )
        .get(args[1], args[0], ...args.slice(2)).value;
    });
  raw.function("__d1_row", { varargs: true }, (...values) => {
    // Conservative SQLite record-header allowance; catches the whole-row limit too.
    if (
      values.some((x) => byteSize(x) > 2000000) ||
      values.reduce((n, x) => n + byteSize(x) + 9, 1) > 2000000
    )
      throw Error("D1_ROW_TOO_BIG");
    return 1;
  });
  let version = -1;
  const quote = (x) => '"' + x.replaceAll('"', '""') + '"';
  return {
    close() {
      native.close();
    },
    installRows() {
      const next = raw.prepare("PRAGMA schema_version").get().schema_version;
      if (next === version) return;
      for (const { name } of raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()) {
        const columns = raw
          .prepare("PRAGMA table_info(" + quote(name) + ")")
          .all()
          .map((x) => "NEW." + quote(x.name))
          .join(",");
        for (const action of ["INSERT", "UPDATE"])
          raw.exec(
            "CREATE TEMP TRIGGER IF NOT EXISTS " +
              quote("__d1_" + name + action) +
              " AFTER " +
              action +
              " ON " +
              quote(name) +
              " BEGIN SELECT __d1_row(" +
              columns +
              "); END",
          );
      }
      version = raw.prepare("PRAGMA schema_version").get().schema_version;
    },
    result(value) {
      const rows = Array.isArray(value) ? value : value ? [value] : [];
      for (const row of rows)
        if (Object.values(row).some((x) => byteSize(x) > 2000000))
          throw Error("D1_RESULT_TOO_BIG");
      return value;
    },
  };
}
