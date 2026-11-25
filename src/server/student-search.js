import { PINYIN_PRIMARY, PINYIN_VARIANTS } from "./student-pinyin-data.js";

const main = Object.create(null);
const alternate = Object.create(null);
for (const line of PINYIN_PRIMARY.split("\n")) {
  const [reading, chars] = line.split(" ");
  for (const char of chars) main[char] = reading;
}
for (const line of PINYIN_VARIANTS.split("\n")) {
  const [char, ...readings] = line.split(" ");
  alternate[char] = readings;
}
const surnames = {
  曾: ["zeng", "ceng"], 单: ["shan", "chan", "dan"], 單: ["shan", "chan", "dan"],
  仇: ["qiu", "chou"], 解: ["xie", "jie"], 查: ["zha", "cha"],
  区: ["ou", "qu"], 區: ["ou", "qu"], 朴: ["piao", "pu"], 樸: ["piao", "pu"],
  繁: ["po", "fan"], 盖: ["ge", "gai"], 蓋: ["ge", "gai"],
  种: ["chong", "zhong"], 種: ["chong", "zhong"], 覃: ["qin", "tan"],
  乐: ["yue", "le"], 樂: ["yue", "le"],
};
const han = /\p{Script=Han}/u;
const word = /\p{L}/u;
function rendered(parts) {
  return [
    parts.map(({ full }) => full).join(""),
    parts.map(({ initial }) => initial).join(""),
  ];
}
export function studentSearchKeys(name) {
  const value = String(name ?? "").toLowerCase().trim();
  if (!value) return [];
  const compact = value.replace(/\s/gu, "");
  if (!han.test(value)) {
    const initials = value.split(/\s+/u)
      .map((part) => Array.from(part).find((char) => word.test(char)) || "")
      .join("");
    return [...new Set([compact, initials].filter(Boolean))];
  }

  const segments = value.match(/\p{Script=Han}|[^\p{Script=Han}\s]+/gu) || [];
  const parts = segments.map((part, index) => {
    if (!han.test(part)) {
      const initial = Array.from(part).find((char) => word.test(char)) || part;
      return { full: part, initial, variants: [] };
    }
    const primary = main[part] || part;
    const options = index === 0 && surnames[part]
      ? surnames[part] : [primary, ...(alternate[part] || [])];
    return { full: options[0], initial: Array.from(options[0])[0], variants: options.slice(1) };
  });
  const keys = new Set(rendered(parts));
  if (segments.some((part) => !han.test(part))) keys.add(compact);
  for (let index = 0; index < parts.length && keys.size < 8; index++)
    for (const reading of parts[index].variants) {
      const changed = parts.slice();
      changed[index] = { full: reading, initial: reading[0] };
      for (const key of rendered(changed)) {
        if (keys.size === 8) break;
        keys.add(key);
      }
    }
  return [...keys].filter(Boolean);
}
export function withStudentSearchKeys(row, name = row.name) {
  return { ...row, search_keys: studentSearchKeys(name) };
}
