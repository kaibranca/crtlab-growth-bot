import { test } from "node:test"; import assert from "node:assert/strict";
import { T, check, read, ContractError } from "../scripts/store.mjs";
import { C, CONTRACTS } from "../scripts/contracts.mjs";
import { frozen } from "../scripts/lib.mjs";

const c = { name: "x", path: "x.json", maxAgeH: 2, fresh: (d) => d.at, shape: T.obj({ at: T.iso, n: T.num, list: T.arr(T.obj({ id: T.str })) }) };
const now = Date.parse("2026-11-14T12:00:00Z");
const good = JSON.stringify({ at: "2026-11-14T11:00:00Z", n: 3, list: [{ id: "a" }] });

test("contract: ok / broken / shape / stale are told apart", () => {
  assert.equal(check(c, { now, text: good }).kind, "ok");
  assert.equal(check(c, { now, text: "{nope" }).kind, "broken");
  assert.match(check(c, { now, text: JSON.stringify({ at: "2026-11-14T11:00:00Z", n: "3", list: [{}] }) }).detail, /n: want number.*list\[0\]\.id/);
  assert.equal(check(c, { now: now + 5 * 3.6e6, text: good }).kind, "stale");
  assert.equal(check({ ...c, path: "does/not/exist.json" }).kind, "missing");
});

test("read: throws instead of handing back an empty default", () => {
  assert.throws(() => read({ ...c, path: "does/not/exist.json" }), ContractError);
});

test("freeze FAILS CLOSED: broken or bad-date file = hold; missing = no freeze", () => {
  assert.equal(frozen("hooks", { kind: "broken" }), true);
  assert.equal(frozen("hooks", { kind: "shape" }), true);
  assert.equal(frozen("hooks", { kind: "missing" }), false);
  const future = { kind: "ok", data: { until: new Date(Date.now() + 864e5).toISOString(), holds: { hooks: "" } } };
  assert.equal(frozen("hooks", future), true);
  assert.equal(frozen("bandit", future), false);
  assert.equal(frozen("hooks", { kind: "ok", data: { ...future.data, until: "2020-01-01T00:00:00Z" } }), false);
  assert.equal(check(C.freeze, { text: JSON.stringify({ until: "soon", set: "", why: "", holds: {} }) }).kind, "shape");
});

test("registry: unique names, every live contract file passes its own shape", () => {
  assert.equal(new Set(CONTRACTS.map((x) => x.name)).size, CONTRACTS.length);
  for (const x of CONTRACTS) { const r = check(x, { now: Date.now() }); assert.ok(["ok", "stale", "missing"].includes(r.kind), `${x.name}: ${r.kind} ${r.detail}`); }
});
