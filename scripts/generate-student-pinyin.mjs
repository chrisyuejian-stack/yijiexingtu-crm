import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const vendor = new URL("../src/console/vendor/pinyin-pro.js", import.meta.url);
const runtime = vm.createContext({});
vm.runInContext(readFileSync(vendor, "utf8"), runtime);
const decoder = new TextDecoder("gb18030");
const chars = new Set("歐區樂單蓋種樸龔龐蘇蕭顧陳張劉楊趙吳鄭馮謝羅鍾鐘練葉黃莊簡賴賈鄧歸萬與於臺寶鵬曉詩藝鈺珩翀燊彧婳玥翊奕宸芃喆淏沄昱皓琰梓垚鑫熙瑾");
for (let row = 0xb0; row <= 0xf7; row++)
  for (let cell = 0xa1; cell <= 0xfe; cell++) {
    const char = decoder.decode(Uint8Array.of(row, cell));
    if (/^\p{Script=Han}$/u.test(char)) chars.add(char);
  }
const primary = new Map(), variants = [];
for (const char of chars) {
  const options = { toneType: "none", type: "array" };
  const main = runtime.pinyinPro.pinyin(char, options)[0]?.replaceAll("ü","v");
  if (!/^[a-z]+$/.test(main)) continue;
  primary.set(main,(primary.get(main) || "")+char);
  const others = [...new Set(runtime.pinyinPro.pinyin(char, { ...options, multiple: true })
    .map((part) => part.replaceAll("ü","v")).filter((part) => part !== main && /^[a-z]+$/.test(part)))].slice(0,2);
  if (others.length) variants.push(char+" "+others.join(" "));
}
const license = readFileSync(new URL("../src/console/vendor/pinyin-pro.LICENSE",import.meta.url),"utf8");
writeFileSync(new URL("../src/server/student-pinyin-data.js",import.meta.url),
  "/* Generated from the vendored pinyin-pro dictionary.\n"+license+"*/\n"+
  "export const PINYIN_PRIMARY = `"+[...primary].sort().map(([part,letters])=>part+" "+letters).join("\n")+"`;\n"+
  "export const PINYIN_VARIANTS = `"+variants.join("\n")+"`;\n");
