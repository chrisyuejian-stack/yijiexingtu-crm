// 最小 OOXML 工作簿：ZIP STORE + inlineStr，用户内容永不进入公式或 HTML。
const enc = new TextEncoder();
function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
}
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function header(length, values) {
  const bytes = new Uint8Array(length),
    v = new DataView(bytes.buffer);
  for (const [offset, size, n] of values)
    size === 2 ? v.setUint16(offset, n, true) : v.setUint32(offset, n, true);
  return bytes;
}
function zip(files) {
  let offset = 0,
    parts = [],
    dirs = [],
    dirLength = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name),
      data = enc.encode(text),
      sum = crc(data),
      h = header(30, [
        [0, 4, 0x04034b50],
        [4, 2, 20],
        [6, 2, 0x800],
        [12, 2, 0x21],
        [14, 4, sum],
        [18, 4, data.length],
        [22, 4, data.length],
        [26, 2, n.length],
      ]),
      d = header(46, [
        [0, 4, 0x02014b50],
        [4, 2, 20],
        [6, 2, 20],
        [8, 2, 0x800],
        [14, 2, 0x21],
        [16, 4, sum],
        [20, 4, data.length],
        [24, 4, data.length],
        [28, 2, n.length],
        [42, 4, offset],
      ]);
    parts.push(h, n, data);
    dirs.push(d, n);
    offset += h.length + n.length + data.length;
    dirLength += d.length + n.length;
  }
  const end = header(22, [
      [0, 4, 0x06054b50],
      [8, 2, dirs.length / 2],
      [10, 2, dirs.length / 2],
      [12, 4, dirLength],
      [16, 4, offset],
    ]),
    all = [...parts, ...dirs, end],
    out = new Uint8Array(offset + dirLength + 22);
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function col(index) {
  let s = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function moneyCell(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? { money: true, value }
    : value;
}
export function workbook(rows, sheet = "数据") {
  if (rows.length > 20001) throw Error("export too large");
  const body = rows
    .map(
      (row, r) =>
        '<row r="' +
        (r + 1) +
        '">' +
        row
          .map((value, c) => {
            const address = col(c) + (r + 1);
            if (
              value &&
              typeof value === "object" &&
              value.money === true &&
              typeof value.value === "number" &&
              Number.isFinite(value.value)
            )
              return (
                '<c r="' + address + '" s="1"><v>' + value.value + "</v></c>"
              );
            return typeof value === "number" && Number.isFinite(value)
              ? '<c r="' + address + '"><v>' + value + "</v></c>"
              : '<c r="' +
                  address +
                  '" t="inlineStr"><is><t xml:space="preserve">' +
                  xml(value) +
                  "</t></is></c>";
          })
          .join("") +
        "</row>",
    )
    .join("");
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' +
      xml(sheet) +
      '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml":
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml":
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>' +
      body +
      "</sheetData></worksheet>",
  });
}

// Import accepts ordinary Excel STORE/DEFLATE OOXML. No macros, formulas, external entities or evaluation.
export async function readWorkbook(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > 750000 ||
    bytes.length < 22
  )
    throw Error("Excel 文件过大或格式不正确");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    files = {};
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("请上传 xlsx 文件，不支持旧版 xls");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true),
    total = 0;
  if (count > 100) throw Error("Excel 文件结构过大");
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw Error("Excel 文件损坏");
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      size = view.getUint32(at + 20, true),
      rawSize = view.getUint32(at + 24, true),
      n = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true),
      sum = view.getUint32(at + 16, true);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + n));
    at += 46 + n + extra + comment;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      rawSize > 4000000 ||
      total + rawSize > 8000000 ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("vbaProject") ||
      name.includes("externalLinks")
    )
      throw Error("Excel 含不支持的内容");
    total += rawSize;
    if (
      ![
        "xl/worksheets/sheet1.xml",
        "xl/sharedStrings.xml",
        "xl/workbook.xml",
      ].includes(name)
    )
      continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw Error("Excel 文件损坏");
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (start + size > bytes.length) throw Error("Excel 文件损坏");
    let data = bytes.slice(start, start + size);
    if (method === 8) {
      const reader = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > rawSize || size > 4000000) {
          await reader.cancel();
          throw Error("Excel 解压体积超限");
        }
        chunks.push(p.value);
      }
      data = new Uint8Array(size);
      let offset = 0;
      for (const p of chunks) {
        data.set(p, offset);
        offset += p.length;
      }
    }
    if (data.length !== rawSize || crc(data) !== sum)
      throw Error("Excel 文件校验失败");
    const text = decoder.decode(data);
    if (/<!DOCTYPE|<!ENTITY|<f(?:\s|>)/i.test(text))
      throw Error("请去除 Excel 公式后重新导入");
    files[name] = text;
  }
  if (!files["xl/worksheets/sheet1.xml"]) throw Error("未找到工作表");
  if ((files["xl/workbook.xml"]?.match(/<sheet\s/g) || []).length > 1)
    throw Error("请只保留一个待导入工作表");
  const decode = (text) =>
    text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (token) => {
      if (token.startsWith("&#")) {
        const n =
          token[2] === "x"
            ? parseInt(token.slice(3, -1), 16)
            : Number(token.slice(2, -1));
        if (n < 0 || n > 0x10ffff) throw Error("Excel 字符不正确");
        return String.fromCodePoint(n);
      }
      return {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      }[token];
    });
  const texts = (xml) =>
    [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((m) => decode(m[1]))
      .join("");
  const shared = [
    ...(files["xl/sharedStrings.xml"] || "").matchAll(
      /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g,
    ),
  ].map((m) => texts(m[1]));
  const rows = [];
  for (const match of files["xl/worksheets/sheet1.xml"].matchAll(
    /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g,
  )) {
    if (rows.length >= 2001) throw Error("单个 Excel 最多2000行，请拆分文件");
    const row = [];
    for (const cell of match[1].matchAll(
      /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cell[1]);
      if (!ref) throw Error("Excel 单元格不正确");
      let col = 0;
      for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      col--;
      if (col > 30) throw Error("Excel 列数过多");
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1],
        content = cell[2] || "",
        v = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1] || "";
      if (type === "e") throw Error("Excel 存在错误单元格");
      row[col] =
        type === "inlineStr"
          ? texts(content)
          : type === "s"
            ? (shared[Number(v)] ?? "")
            : decode(v);
      if (String(row[col]).length > 6000) throw Error("Excel 单元格内容过长");
    }
    if (row.some((x) => String(x || "").trim())) rows.push(row);
  }
  if (rows.length < 2) throw Error("Excel 没有可导入数据");
  const [headers, ...data] = rows;
  if (new Set(headers).size !== headers.length) throw Error("Excel 表头重复");
  return data.map((row, index) => ({
    index: index + 2,
    values: Object.fromEntries(
      headers.map((h, i) => [h, String(row[i] ?? "").trim()]),
    ),
  }));
}
