// 自动合并与分流策略。默认不合并（fail-closed）：任何不确定都返回 merge:false。
// 用法：node scripts/automerge-policy.mjs decide < pr.json   → {"merge":bool,"reason":"..."}
//       node scripts/automerge-policy.mjs risky  < pr.json   → {"risky":[files]}
// pr.json: { draft, ci, labels:[...], files:[...] | null }
export const RISKY_PATH = /^(migrations\/|\.github\/|deploy\/|platform\/|server\.mjs$|package(-lock)?\.json$|scripts\/(build|automerge-policy)\.mjs$|src\/server\/.*(auth|access|session|permission|security|crypto|identity|platform|backup))/i;
export const BLOCKING_LABELS = ['blocked', 'needs-claude', 'hold', 'risk:high'];

export function riskyFiles(files) {
  return (files ?? []).filter(f => RISKY_PATH.test(f));
}

export function decide(pr) {
  if (!pr || typeof pr !== 'object') return { merge: false, reason: '无效输入' };
  if (pr.draft !== false) return { merge: false, reason: '草稿或状态未知' };
  if (pr.ci !== 'success') return { merge: false, reason: 'CI 未通过' };
  if (!Array.isArray(pr.files) || pr.files.length === 0) return { merge: false, reason: '无法取得改动文件列表' };
  if (!Array.isArray(pr.labels)) return { merge: false, reason: '无法取得标签' };
  const hit = BLOCKING_LABELS.find(l => pr.labels.includes(l));
  if (hit) return { merge: false, reason: `带拦截标签 ${hit}` };
  const risky = riskyFiles(pr.files);
  if (risky.length) return { merge: false, reason: `改动高风险路径：${risky.slice(0, 3).join(', ')}` };
  return { merge: true, reason: 'ok' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let pr = null;
  try { pr = JSON.parse(raw); } catch { /* fail-closed */ }
  const mode = process.argv[2];
  if (mode === 'risky') console.log(JSON.stringify({ risky: riskyFiles(pr?.files) }));
  else console.log(JSON.stringify(decide(pr)));
}
