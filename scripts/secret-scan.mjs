// SECRET SCAN — node scripts/secret-scan.mjs   (CI on every push; this repo is PUBLIC)
// Fails if any tracked file holds something shaped like a credential. Uses the same patterns that scrub the run logs.
import fs from "node:fs"; import { execSync } from "node:child_process"; import { SECRET_PATTERNS } from "./run-lib.mjs";
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => f && !/\.(png|jpe?g|gif|mp[34]|woff2?|ico|webp|zip)$/i.test(f));
const SKIP = new Set(["scripts/run-lib.mjs", "test/run-lib.test.mjs"]); // the patterns + their fake test values
const hits = [];
for (const f of files) {
  if (SKIP.has(f) || !fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const [re] of SECRET_PATTERNS) for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
    if (/\*\*\*|\$\{|<[a-z_]+>|\bBearer\s+(\$|`|\w+\))/i.test(m[0])) continue; // already scrubbed / template code, not a value
    hits.push(`${f}: ${m[0].slice(0, 12)}…`);
  }
}
if (hits.length) { console.error(`SECRET SCAN: ${hits.length} possible credential(s) in tracked files:\n` + hits.join("\n")); process.exit(1); }
console.log(`secret scan: ${files.length} files clean`);
