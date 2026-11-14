import test from "node:test"; import assert from "node:assert/strict";
import * as L from "../engine/guard/jobs-lib.mjs";
const T = (s) => Date.parse(s);

test("data: current = ok; behind before 07:10 = ok (release window); behind after = FAIL; unreadable = unknown", () => {
  assert.equal(L.checkData({ live: "v", end: "2026-11-13", due: "2026-11-13" }, T("2026-11-14T12:00Z")).state, "ok");
  assert.equal(L.checkData({ end: "2026-11-12", due: "2026-11-13" }, T("2026-11-14T07:05Z")).state, "ok");
  assert.equal(L.checkData({ end: "2026-11-12", due: "2026-11-13" }, T("2026-11-14T07:30Z")).state, "fail");
  assert.equal(L.checkData(null, T("2026-11-14T12:00Z")).state, "unknown");
});
test("reels: a due slot with no posted id = FAIL; future slots ignored; wrong platform does not count", () => {
  const plan = { date: "2026-11-14", reels: [{ k: 0, ig: { at: "2026-11-14T10:24:00Z" }, fb: { at: "2026-11-14T09:00:00Z" } }, { k: 1, ig: { at: "2026-11-14T20:00:00Z" } }] };
  const now = T("2026-11-14T12:00Z");
  assert.equal(L.checkReels(plan, [{ plan: "2026-11-14", k: 0, plat: "ig", id: "1" }, { plan: "2026-11-14", k: 0, plat: "fb", id: "2" }], now).state, "ok");
  const r = L.checkReels(plan, [{ plan: "2026-11-14", k: 0, plat: "ig", id: "1" }], now);
  assert.equal(r.state, "fail"); assert.match(r.detail, /fb#0/);
  assert.equal(L.checkReels(plan, [{ plan: "2026-11-13", k: 0, plat: "ig", id: "1" }, { plan: "2026-11-13", k: 0, plat: "fb", id: "2" }], now).state, "fail"); // yesterday's post ≠ today's
  assert.equal(L.checkReels(null, [], now).state, "unknown");
});
test("indexnow: any rejected batch in 24 h = FAIL, older ones forgiven", () => {
  const now = T("2026-11-14T12:00Z");
  assert.equal(L.checkIndexNow([{ at: "2026-11-14T08:00Z", status: "HTTP 200", submitted: 4 }], now).state, "ok");
  assert.equal(L.checkIndexNow([{ at: "2026-11-14T08:00Z", status: "HTTP 429" }], now).state, "fail");
  assert.equal(L.checkIndexNow([{ at: "2026-11-12T08:00Z", status: "HTTP 429" }], now).state, "ok");
});
test("sitemap: stale check, errors, or never fetched after 7 d = FAIL; GSC 'indexed' is never read", () => {
  const now = T("2026-11-14T12:00Z"), base = { at: "2026-11-14T06:43Z", submit: "ok", firstSubmitted: "2026-11-13T13:15Z", sitemaps: [{ errors: 0, downloaded: "2026-11-13T13:15Z", contents: [{ indexed: 0 }] }] };
  assert.equal(L.checkSitemap(base, now).state, "ok"); // indexed = 0 must NOT fail it (dead API field)
  assert.equal(L.checkSitemap({ ...base, at: "2026-11-12T06:00Z" }, now).state, "fail");
  assert.equal(L.checkSitemap({ ...base, sitemaps: [{ errors: 2 }] }, now).state, "fail");
  assert.equal(L.checkSitemap({ ...base, firstSubmitted: "2026-11-01T00:00Z", sitemaps: [{ errors: 0, downloaded: null }] }, now).state, "fail");
});
test("core: hourly > 2 h or daily > 26 h = FAIL", () => {
  const now = T("2026-11-14T12:00Z");
  assert.equal(L.checkCore({ hourly: { at: "2026-11-14T11:17Z" }, daily: { at: "2026-11-14T06:40Z" } }, now).state, "ok");
  assert.equal(L.checkCore({ hourly: { at: "2026-11-14T09:00Z" }, daily: { at: "2026-11-14T06:40Z" } }, now).state, "fail");
  assert.equal(L.checkCore({ hourly: { at: "2026-11-14T11:17Z" }, daily: { at: "2026-11-13T06:40Z" } }, now).state, "fail");
});
test("truth: frozen DB, north star off by > 15 %, mostly-unattributed visitors = FAIL", () => {
  const now = T("2026-11-14T12:00Z");
  assert.equal(L.checkDbLive("2026-11-14T11:00Z", now).state, "ok");
  assert.equal(L.checkDbLive("2026-11-12T11:00Z", now).state, "fail"); // the 08-25 Neon-snapshot trap
  assert.equal(L.checkNorthStar(138, 140).state, "ok");
  assert.equal(L.checkNorthStar(90, 140).state, "fail");
  assert.equal(L.checkNorthStar(3, 6).state, "ok"); // small numbers: ±5 floor
  assert.equal(L.checkAttribution(67, 100).state, "fail");
  assert.equal(L.checkAttribution(30, 100).state, "ok");
});
