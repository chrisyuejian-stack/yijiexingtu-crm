// One measurement per D1 execution; batch statements are unwrapped to avoid double counting.
export function measureDatabase(db, timing) {
  if (!db) return db;
  const originals = new WeakMap();
  function collect(result) {
    for (const item of Array.isArray(result) ? result : [result]) {
      const meta = item?.meta;
      if (!meta) continue;
      for (const [key, value] of Object.entries({sql_duration_ms: meta.timings?.sql_duration_ms ?? meta.duration, rows_read: meta.rows_read, rows_written: meta.rows_written})) {
        if (Number.isFinite(value)) timing[key] = (timing[key] ?? 0) + value;
      }
      if (!timing.served_by_region && meta.served_by_region)
        timing.served_by_region = String(meta.served_by_region).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    }
    return result;
  }
  async function measure(execute) {
    timing.trips++;
    const start = performance.now();
    try { return collect(await execute()); }
    finally { timing.dbMs += performance.now() - start; }
  }
  function wrap(statement) {
    const result = {
      bind: (...args) => wrap(statement.bind(...args)),
      first: async (column) => {
        const rows = (await measure(() => statement.all())).results || [];
        if (!rows.length) return null;
        if (column === undefined) return rows[0];
        if (!(column in rows[0])) throw new Error("D1_COLUMN_NOTFOUND");
        return rows[0][column];
      },
      all: (...args) => measure(() => statement.all(...args)),
      run: (...args) => measure(() => statement.run(...args)),
      raw: (...args) => measure(() => statement.raw(...args)),
    };
    originals.set(result, statement);
    return result;
  }
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (statements) => measure(() => db.batch(statements.map((item) => originals.get(item)))),
  };
}
export function apiTiming(timing, started) {
  const metrics = [`db;dur=${timing.dbMs.toFixed(1)};desc="${timing.trips}"`, `app;dur=${(performance.now() - started).toFixed(1)}`];
  for (const key of ["sql_duration_ms", "rows_read", "rows_written"])
    metrics.push(Number.isFinite(timing[key]) ? `${key};${key === "sql_duration_ms" ? "dur" : "desc"}=${key === "sql_duration_ms" ? timing[key].toFixed(3) : '"' + timing[key] + '"'}` : `${key};desc="unavailable"`);
  metrics.push(`served_by_region;desc="${timing.served_by_region || "unavailable"}"`);
  return metrics.join(", ");
}
