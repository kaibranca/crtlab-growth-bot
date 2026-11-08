// dev: node engine/try.mjs <date> <model> [rank] [fam] [angle] [pace] → out/try.json
import fs from "node:fs"; import { candidates } from "./stories.mjs"; import { copy } from "./copy.mjs"; import { lesson, ANGLES } from "./lesson.mjs";
const [D, M, R = 0, fam = "name", angle = "rule", pace = "short"] = process.argv.slice(2);
const c = candidates(D).filter((s) => s.model === M).sort((a, b) => b.score - a.score)[+R];
if (!c) { console.log("none"); process.exit(1); }
c.copy = copy(c, fam); c.lesson = lesson(c, ANGLES[c.model].includes(angle) ? angle : "rule"); c.look = { pace };
fs.mkdirSync("out", { recursive: true }); fs.writeFileSync("out/try.json", JSON.stringify(c));
console.log(c.id, c.copy.title.join(" "), "bars", c.bars.length, "kb", c.kb, c.trade || c.measure);
