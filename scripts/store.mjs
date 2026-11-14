// DATA CONTRACTS (layer 2) — the only way decision code should read machine state.
// The old way, J(file, {}), returned an empty default when a file was missing, broken or the wrong shape, so machines
// carried on deciding from nothing (values.json broken 4 h on 11-14; a broken freeze.json would have UN-frozen every
// machine). Here every read is checked: exists · parses · has the right shape · is fresh. A failure is an error the
// caller must handle, and `failClosed` gives the safe answer for safety switches.
import fs from "node:fs";

// ── shape checker: tiny, explicit, no dependency. Each type returns a list of "path: problem" strings. ──
const err = (p, m) => [`${p || "(root)"}: ${m}`];
export const T = {
  any: () => [],
  str: (v, p) => (typeof v === "string" ? [] : err(p, `want string, got ${typeof v}`)),
  num: (v, p) => (typeof v === "number" && Number.isFinite(v) ? [] : err(p, `want number, got ${JSON.stringify(v)}`)),
  bool: (v, p) => (typeof v === "boolean" ? [] : err(p, `want boolean, got ${typeof v}`)),
  iso: (v, p) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? [] : err(p, `want ISO date, got ${JSON.stringify(v)}`)),
  opt: (t) => (v, p) => (v == null ? [] : t(v, p)),
  oneOf: (...xs) => (v, p) => (xs.includes(v) ? [] : err(p, `want one of ${xs.join("|")}, got ${JSON.stringify(v)}`)),
  arr: (t, { min = 0 } = {}) => (v, p) => !Array.isArray(v) ? err(p, "want array") : v.length < min ? err(p, `want ≥ ${min} items, got ${v.length}`)
    : v.flatMap((x, i) => t(x, `${p}[${i}]`)).slice(0, 10),
  obj: (fields = {}) => (v, p) => (v == null || typeof v !== "object" || Array.isArray(v) ? err(p, "want object")
    : Object.entries(fields).flatMap(([k, t]) => t(v[k], p ? `${p}.${k}` : k))),
  map: (t) => (v, p) => (v == null || typeof v !== "object" || Array.isArray(v) ? err(p, "want object")
    : Object.entries(v).flatMap(([k, x]) => t(x, `${p}.${k}`)).slice(0, 10)),
};

export class ContractError extends Error {
  constructor(name, kind, detail) { super(`${name}: ${kind}${detail ? " — " + detail : ""}`); this.contract = name; this.kind = kind; }
}

// Check one contract against the file on disk (or a given text, for tests). kind: ok | missing | broken | shape | stale
export function check(c, { now = Date.now(), text } = {}) {
  if (text == null) { if (!fs.existsSync(c.path)) return { kind: "missing" }; text = fs.readFileSync(c.path, "utf8"); }
  let data;
  try { data = c.path.endsWith(".jsonl") ? text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(text); }
  catch (e) { return { kind: "broken", detail: String(e.message).slice(0, 120) }; }
  const problems = c.shape(data, "");
  if (problems.length) return { kind: "shape", detail: problems.slice(0, 3).join("; "), data };
  if (c.maxAgeH && c.fresh) {
    const at = Date.parse(c.fresh(data)), ageH = (now - at) / 3.6e6;
    if (!(ageH <= c.maxAgeH)) return { kind: "stale", detail: Number.isNaN(at) ? "no timestamp" : `${ageH.toFixed(1)} h old (max ${c.maxAgeH} h)`, data, ageH };
    return { kind: "ok", data, ageH };
  }
  return { kind: "ok", data };
}

// Read through a contract. Throws ContractError unless the file is ok (or the failure kind is allowed by the caller).
export function read(c, { allow = [], now } = {}) {
  const r = check(c, { now });
  if (r.kind === "ok" || allow.includes(r.kind)) return r.data;
  throw new ContractError(c.name, r.kind, r.detail);
}
