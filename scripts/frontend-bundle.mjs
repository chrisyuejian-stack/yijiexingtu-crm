// Browser-only composition. Existing two asset paths and Worker allowlist stay unchanged.
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
export async function tenantAssets() {
  const [tokens, components, css, source, icons, app, calendar] =
    await Promise.all([
      read("src/ui/tokens.css"),
      read("src/ui/components.css"),
      read("src/tenant/app.css"),
      read("src/ui/components.js"),
      read("src/ui/icons.svg"),
      read("src/tenant/app.js"),
      read("src/tenant/calendar.js"),
    ]);
  const symbols = {};
  for (const match of icons.matchAll(
    /<symbol\s+([^>]+)>([\s\S]*?)<\/symbol>/g,
  )) {
    const id = /id="([^"]+)"/.exec(match[1])[1];
    symbols[id] = [
      ...match[2].matchAll(/<([a-z]+)\s+([^>]+)\/?>(?:<\/\1>)?/g),
    ].map((m) => [
      m[1],
      Object.fromEntries(
        [...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
      ),
    ]);
  }
  const exports = [
    ...source.matchAll(/export (?:async )?(?:function|const|class)\s+(\w+)/g),
  ].map((m) => m[1]);
  const shared = (await read("src/shared/view.js")).replace(
    /export (?=(?:function|const)\b)/g,
    "",
  );
  const ui = source
    .replace(/import \{[^}]+\} from "..\/shared\/view.js";/, "")
    .replace(/export \{[^}]+\};/g, "")
    .replace(/export (?=(?:async )?(?:function|const|class)\b)/g, "")
    .replaceAll("import.meta.url", "document.baseURI");
  return {
    js: `globalThis.ChannelUISymbols=${JSON.stringify(symbols)};\n(()=>{${shared}\n${ui}\nglobalThis.ChannelUI={switch:switchControl, studentDisplay,personStatus,leadMoveAllowed,${exports.join(",")}};})();\n${calendar}\n${app}\n${await read("src/tenant/c2.js")}\n${await read("src/tenant/c3.js")}\n${await read("src/tenant/v2.js")}\n${await read("src/tenant/v2p.js")}\n${await read("src/tenant/v2t.js")}\n${await read("src/tenant/v2f.js")}\n${await read("src/tenant/v2s.js")}\n${await read("src/tenant/v2a.js")}\n${await read("src/tenant/v2m.js")}\n${await read("src/tenant/v2promo.js")}\n${await read("src/tenant/v2pay.js")}\n${await read("src/tenant/v2today.js")}\n${await read("src/tenant/yx.js")}\n${await read("src/tenant/yx-settings.js")}\n${await read("src/tenant/yx-plans.js")}\n${await read("src/tenant/yx-plan2.js")}\n${await read("src/tenant/yx-home.js")}\n${await read("src/tenant/yx-ai.js")}\n${await read("src/tenant/yx-content.js")}\n${await read("src/tenant/yx-growth.js")}\n${await read("src/tenant/yx-reports.js")}`,
    css:
      tokens +
      "\n" +
      components +
      "\n" +
      css +
      "\n" +
      (await read("src/tenant/rebuild.css")) +
      "\n" +
      (await read("src/tenant/polish.css")) +
      "\n" +
      (await read("src/tenant/yx.css")) +
      "\n" +
      (await read("src/tenant/yx-theme.css")) +
      "\n" +
      (await read("src/tenant/v2.css")),
  };
}
