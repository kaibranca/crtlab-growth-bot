// LINK CHECK (weekly): every sitemap URL must answer 200. A page that 404s or 500s is lost traffic nobody sees.
import fs from "node:fs";
import { SITE, get } from "./lib.mjs";
const sm = await get(`${SITE}/sitemap.xml`);
const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const bad = [];
for (let i = 0; i < urls.length; i += 4) {
  const rs = await Promise.all(urls.slice(i, i + 4).map(async (u) => [u, (await get(u, {}, 30000)).status]));
  for (const [u, s] of rs) if (s !== 200) bad.push([u.replace(SITE, ""), s]);
}
fs.writeFileSync("data/linkcheck.json", JSON.stringify({ at: new Date().toISOString(), checked: urls.length, broken: bad }, null, 1));
console.log(`checked ${urls.length}, broken ${bad.length}`, bad.slice(0, 20));
