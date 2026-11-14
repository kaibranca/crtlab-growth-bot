// DATA CONTRACTS registry — one entry per machine state file that decisions depend on.
// owner = the ONE step allowed to write it (checked against the measured map in data/guard/io.json).
// maxAgeH = older than this and the data is stale: a decision must not use it as "now".
// Add a file here before any new code reads it. Shapes cover the fields decisions use, not every field.
import { T } from "./store.mjs";
const at = (d) => d.at;

const list = [
  { name: "hands", path: "data/machines/hands.json", owner: "human",
    shape: T.map((v, p) => (typeof v === "string" ? [] : T.obj({ on: T.bool, why: T.str })(v, p))) },
  { name: "freeze", path: "data/machines/freeze.json", owner: "human or hourly/guard",
    shape: T.obj({ until: T.iso, set: T.str, why: T.str, holds: T.map(T.str) }) },
  { name: "values", path: "data/machines/values.json", owner: "human",
    shape: T.obj({ northStar: T.str, rules: T.arr(T.any, { min: 1 }), never: T.arr(T.any, { min: 1 }) }) },
  { name: "works", path: "data/works/plan.json", owner: "hourly/works", maxAgeH: 3, fresh: at,
    shape: T.obj({ at: T.iso, families: T.arr(T.obj({ fam: T.str, pages: T.num, accounts90: T.num, visitors90: T.opt(T.num) }), { min: 1 }),
      focus: T.arr(T.obj({ path: T.str, fam: T.str })), tiers: T.map(T.any) }) },
  { name: "hooks", path: "data/ai/hooks.json", owner: "hourly/ai-machine",
    shape: T.obj({ experiments: T.arr(T.obj({ id: T.str, family: T.str, status: T.oneOf("running", "won", "lost", "superseded", "paused", "ended", "void") })) }) },
  { name: "timeline", path: "data/machines/timeline.json", owner: "hourly/timeline", maxAgeH: 3, fresh: at,
    shape: T.obj({ at: T.iso, events: T.arr(T.obj({ at: T.iso, kind: T.str, what: T.str })) }) },
  { name: "ai-plan", path: "data/ai/plan.json", owner: "hourly/ai-machine", maxAgeH: 3, fresh: at,
    shape: T.obj({ at: T.iso, families: T.arr(T.obj({ family: T.str, pages: T.num })) }) },
  { name: "traffic-plan", path: "data/traffic/plan.json", owner: "daily/traffic", maxAgeH: 30, fresh: at,
    shape: T.obj({ at: T.iso, demand: T.arr(T.obj({ q: T.str })) }) },
  { name: "google-plan", path: "data/google/plan.json", owner: "daily/google", maxAgeH: 30, fresh: at,
    shape: T.obj({ at: T.iso, coverage: T.arr(T.obj({ family: T.str, pages: T.num })) }) },
  { name: "steps", path: "data/guard/steps.json", owner: "core runtime", maxAgeH: 3, fresh: (d) => d.hourly?.at,
    shape: T.obj({ hourly: T.obj({ at: T.iso, steps: T.map(T.obj({ last: T.str, streak: T.num })) }) }) },
  { name: "drops", path: "data/engine/drops.json", owner: "daily/drops", maxAgeH: 30, fresh: at,
    shape: T.obj({ at: T.iso, end: T.str, metrics: T.map(T.obj({ level: T.oneOf("drop", "watch", "rise", "normal", "thin", "unknown") })) }) },
  { name: "series", path: "data/engine/series.json", owner: "daily/drops", maxAgeH: 30, fresh: at,
    shape: T.obj({ at: T.iso, from: T.str, end: T.str, series: T.obj({ accounts: T.map(T.num) }) }) },
  { name: "learn", path: "data/engine/learn.json", owner: "daily/learn", maxAgeH: 30, fresh: at,
    shape: T.obj({ at: T.iso, learnability: T.obj({ groups: T.num }), groups: T.arr(T.obj({ day0: T.str, state: T.str, n: T.num })) }) },
  { name: "rot", path: "data/engine/rot.json", owner: "hourly/rot", maxAgeH: 3, fresh: at,
    shape: T.obj({ at: T.iso, checks: T.arr(T.obj({ id: T.str, what: T.str, state: T.oneOf("ok", "warn", "fail", "learning"), detail: T.str })) }) },
  { name: "jobs", path: "data/engine/jobs.json", owner: "hourly/jobs", maxAgeH: 3, fresh: at,
    shape: T.obj({ at: T.iso, checks: T.arr(T.obj({ id: T.str, job: T.str, state: T.oneOf("ok", "fail", "unknown"), detail: T.str }), { min: 1 }) }) },
  { name: "ledger", path: "data/machines/ledger.jsonl", owner: "shared log",
    shape: T.arr(T.obj({ at: T.iso, machine: T.str, kind: T.str })) },
];
export const C = Object.fromEntries(list.map((c) => [c.name, c]));
export const CONTRACTS = list;
