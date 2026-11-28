// User-confirmed default, shared by normal creation and read repair of legacy imports.
export const compoundSurnames = [ "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "皇甫", "尉迟", "公羊", "赫连", "澹台", "公冶", "宗政", "濮阳", "淳于", "单于", "太叔", "申屠", "公孙", "仲孙", "轩辕", "令狐", "钟离", "宇文", "长孙", "慕容", "司徒", "司空", "鲜于", "闾丘", "百里", "东郭", "南宫", "西门", "呼延", "羊舌", "微生", "南门", "第五", "东门", "端木", "歐陽", "司馬", "諸葛", "東方", "尉遲", "鍾離", "鐘離", "長孫", "公孫", "軒轅", "閭丘", "東郭", "東門" ];

export function defaultNickname(name) {
  const value = String(name || "").trim();
  if (!/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]+$/u.test(value)) return value;
  return (compoundSurnames.find(s => value.startsWith(s)) || Array.from(value)[0]) + "同学";
}

export function studentNickname(name, value) {
  return typeof value === "string" && value.trim() && value.trim() !== "X 同学" ? value.trim() : defaultNickname(name);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function planStudentMask(student = {}, extraNames = []) {
  const names = [...new Set([student.name, ...extraNames].map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const rawNick = String(student.nickname || "").trim();
  const leaksLegal = names.some((n) => rawNick === n || (n.length > 1 && rawNick.includes(n)));
  const safeName = rawNick && !leaksLegal ? rawNick : "同学";
  const rules = names
    .filter((n) => n !== safeName)
    .map((n) => {
      const esc = escapeRe(n);
      if (n.length > 1) return new RegExp(esc, "g");
      if (/^[A-Za-z0-9_]$/.test(n)) return new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, "g");
      return new RegExp(`(?<![\\p{Script=Han}A-Za-z0-9])${esc}(?!同学)`, "gu");
    });
  const redactText = (text) => {
    let out = text;
    for (const re of rules) out = out.replace(re, safeName);
    return out;
  };
  const redactValue = (value, key = "") => {
    if (typeof value === "string") {
      if (["id", "revision_id", "asset_base"].includes(key) || key.endsWith("_id") || key.endsWith("_url")) return value;
      return redactText(value);
    }
    if (Array.isArray(value)) return value.map((x) => redactValue(x));
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, k)]));
    return value;
  };
  return { safeName, rawNick, leaksLegal, redactValue };
}
