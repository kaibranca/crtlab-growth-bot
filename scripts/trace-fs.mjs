// IO TRACE — preloaded into every step by the core runtime (node --import). Records which repo files the step really
// reads and writes, so the data map is measured in production, not guessed from source. Never throws into the step.
import fs from "node:fs"; import path from "node:path"; import { syncBuiltinESMExports } from "node:module";

const ROOT = process.cwd(), OUT = process.env.TRACE_OUT;
const reads = new Set(), writes = new Set();
const orig = { writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync };
const norm = (p) => {
  try {
    const abs = path.resolve(String(p instanceof URL ? p.pathname : p));
    if (!abs.startsWith(ROOT + path.sep) || abs.includes(`${path.sep}node_modules${path.sep}`)) return null;
    // dated files collapse to one pattern: data/recaps/2026-11-12.json → data/recaps/<date>.json
    return path.relative(ROOT, abs).replace(/\d{4}-\d{2}-\d{2}(T[\d:.-]+Z?)?/g, "<date>").replace(/\d{4}-\d{2}(?=\.jsonl?$)/, "<month>");
  } catch { return null; }
};
const wrap = (obj, name, set) => {
  const f = obj[name]; if (typeof f !== "function") return;
  obj[name] = function (p, ...rest) { if (typeof p !== "number") { const n = norm(p); if (n) set.add(n); } return f.call(this, p, ...rest); };
};
for (const n of ["readFileSync", "existsSync", "readdirSync", "statSync", "createReadStream"]) wrap(fs, n, reads);
for (const n of ["writeFileSync", "appendFileSync", "createWriteStream", "renameSync", "unlinkSync", "rmSync"]) wrap(fs, n, writes);
for (const n of ["readFile", "readdir"]) wrap(fs.promises, n, reads);
for (const n of ["writeFile", "appendFile", "rename", "unlink", "rm"]) wrap(fs.promises, n, writes);
syncBuiltinESMExports();

process.on("exit", () => {
  if (!OUT) return;
  try {
    for (const w of writes) reads.delete(w); // a file it writes is its own, not an input
    orig.mkdirSync(path.dirname(OUT), { recursive: true });
    orig.writeFileSync(OUT, JSON.stringify({ reads: [...reads].sort(), writes: [...writes].sort() }));
  } catch {}
});
