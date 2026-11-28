import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = async () => [await readFile("src/console/app.js", "utf8"), await readFile("src/console/app.css", "utf8")];

test("控制台改版：不用 innerHTML/内联样式/浏览器原生弹窗；动效只用位移/透明度且有减少动态兜底；悬停只在可悬停设备", async () => {
  const [js, css] = await source();
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js), "原生弹窗已全部换成页内确认框 cxAsk / cxAskText");
  assert.match(js, /function cxAsk\(/);
  assert.match(js, /function cxAskText\(/);
  const section = css.slice(css.indexOf("控制台改版"));
  for (const m of section.matchAll(/transition:\s*([^;]+);/g))
    for (const part of m[1].split(/,(?![^(]*\))/)) assert.match(part.trim(), /^(transform|opacity|none)\b/, part);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(section, /@media \(hover: hover\) \{\s*\.cx-nav-item:hover/);
  // 旧页面里的悬停规则以前就有；新写的悬停全部放在 hover 媒体查询里。
  const outside = section.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/, "");
  assert.doesNotMatch(outside, /\.cx-[\w-]+:hover/);
});

test("控制台改版：主管顾问只看到“推广中心”；超级管理员看到全部菜单，合作升学推荐按平台开关显示", async () => {
  const [js] = await source();
  assert.match(js, /const owner = admin\.role !== "consultant";/);
  assert.match(js, /\["promo", "推广中心", \(c\) => cxPromo\(c\), false\],\s*\.\.\.\(owner/);
  assert.match(js, /\.\.\.\(admin\.referrals_enabled\s*\? \[\["referrals", "合作升学推荐"/);
  // 顾问看不到机构名单：发布时“指定机构”选项只在能读到机构名单时出现。
  assert.match(js, /if \(tenantsList\) audOpts\.push\(\["selected", "指定机构"\]\);/);
});

test("控制台改版：推广页面只调用推广与控制台账号接口；收款只做标记；开班需达到最低人数；跟进记录写入时间线", async () => {
  const [js] = await source();
  const cx = js.slice(js.indexOf("推广中心改版（控制台）"));
  for (const m of cx.matchAll(/api\(\s*"([a-z/]+)/g))
    assert.ok(/^(promo|platform\/accounts|platform\/features\/referrals|me$)/.test(m[1]), m[1]);
  // 已收款：专用 paid 接口，带版本号，只是标记。
  assert.match(cx, /api\("promo\/" \+ id \+ "\/applications\/" \+ a\.id \+ "\/paid", "PUT", \{ version: a\.version, paid: on \}\)/);
  // 确认席位：1–200 整数；清空即改回“跟进中”。
  assert.match(cx, /if \(seats\.value === "" \|\| n === 0\) await save\(a, \{ status: "following" \}\);/);
  assert.match(cx, /n < 1 \|\| n > 200/);
  // 开班按钮：还差席位时禁用，并写明还差几席。
  assert.match(cx, /open\.disabled = short > 0;/);
  assert.match(cx, /"确认开班（还差 " \+ short \+ " 席）"/);
  // 跟进记录：按机构读写时间线；记过跟进的“已申请”改为“跟进中”。
  assert.match(cx, /"promo\/" \+ id \+ "\/followups\?tenant_id="/);
  assert.match(cx, /api\("promo\/" \+ id \+ "\/followups", "POST", \{ tenant_id: current\.tenant_id, text: v \}\)/);
  assert.match(cx, /if \(current\.status === "applied" && data\.course\.status === "recruiting"\)/);
  // 发布：合作课/讲座必须有 750 宽长图；海报底图 1080 宽；价格整数元；截止早于第一次课。
  assert.match(cx, /\(await cxWidth\(f\)\) !== 750/);
  assert.match(cx, /\(await cxWidth\(f\)\) !== 1080/);
  assert.match(cx, /need\(st\.long, "请上传课程详情长图（宽 750 像素）"/);
  assert.match(cx, /Number\.isInteger\(n\) && n >= 0/);
  assert.match(cx, /need\(dl < Date\.parse\(list\[0\] \+ ":00\+08:00"\), "申请截止须早于第一次上课"/);
  assert.match(cx, /format: st\.kind === "lecture" \? "lecture" : "course",\s*is_free: st\.free \? 1 : 0,/);
  // 账号：新顾问必须绑定两步验证（先生成密钥，再填动态口令）；不能停用自己和最后一位超级管理员。
  assert.match(cx, /api\("platform\/accounts\/prepare", "POST", \{\}\)/);
  assert.match(cx, /if \(!prepared\) throw Error\("请先生成绑定密钥/);
  assert.match(cx, /if \(self\) op = h\("span", "muted", "本人"\);/);
  assert.match(cx, /a\.role === "owner" && a\.active && owners <= 1/);
});

test("控制台手机端适配（G-04）：导航换行且圆点不压字，表格带数据标签并转卡片列表", async () => {
  const [js, css] = await source();
  const m = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(m, /\.cx-nav\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(m, /\.cx-nav-item\[aria-current="page"\]::after\s*\{[^}]*margin-left:\s*0/);
  assert.match(m, /table\.cx-table\s*\{[^}]*display:\s*block/);
  assert.match(m, /attr\(data-label\)/);
  assert.match(js, /"data-label": cols\[idx\]/);
  assert.match(js, /td\.dataset\.label = cols\[i\]\[0\]/);
});
