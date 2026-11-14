// What else changed here? Any machine judging a result calls this before crediting its own action (Kai 11-14: context).
import fs from "node:fs";
export const timeline = () => { try { return JSON.parse(fs.readFileSync("data/machines/timeline.json", "utf8")).events || []; } catch { return []; } };
// area: a page family or "/" / "indexing" / "sitemap"; returns traffic-facing changes in [from, to] that touch it (or touch everything)
export function changesNear(area, from, to, { except = null } = {}) {
  const a = Date.parse(from), b = Date.parse(to);
  return timeline().filter((e) => e.traffic && Date.parse(e.at) >= a && Date.parse(e.at) <= b && e.what !== except &&
    (e.where === "indexing" || e.where === "all traffic-facing" || e.where === "sitemap" || String(e.where).split(" ").some((w) => w === area || (w.endsWith("*") && area.startsWith(w.slice(0, -1))))));
}
